import { ChildProcess, exec, spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { platform } from 'node:process';
import * as readline from 'node:readline';
import { inspect, promisify } from 'node:util';

import {
  ElectronVersions,
  Fiddle,
  FiddleFactory,
  FiddleSource,
  Installer,
  Runner,
  RunnerSpawnOptions,
  SemVer,
} from '@electron/fiddle-core';
import {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  dialog,
} from 'electron';

import { ELECTRON_DOWNLOAD_PATH, ELECTRON_INSTALL_PATH } from './constants';
import { eventEmitter, getCurrentTemplateDir } from './fiddle-core-inputs';
import { ipcMainManager } from './ipc';
import { addModulesWithFeedback, getPreferredPackageManager } from './npm';
import { treeKill } from './tree-kill';
import { normaliseMaybeDevtronValue } from './utils/devtron';
import {
  DownloadVersionParams,
  ProgressObject,
  StartFiddleParams,
} from '../interfaces';
import { IpcEvents } from '../ipc-events';

const execPromise = promisify(exec);

let installer: Installer;
let runner: Runner;

// Keep track of which fiddle process belongs to which WebContents
const fiddleProcesses = new WeakMap<WebContents, FiddleProcessesValue>();
type FiddleProcessesValue = {
  abortController: AbortController;
  hostApp: {
    childProcess?: ChildProcess;
  } | null;
  RNCLI:
    | {
        type: 'installing node modules';
        childProcess: ChildProcess;
        cwd: string;
      }
    | {
        type: 'running CLI';
        relaunchInProgress: boolean;
        childProcess: ChildProcess;
        cwd: string;
        removeReadyListener?: () => void;
      }
    | null;
};

const downloadingVersions = new Map<string, Promise<any>>();
const removingVersions = new Map<string, Promise<void>>();

/**
 * Start running a React Native fiddle.
 */
export async function startFiddle(
  webContents: WebContents,
  params: StartFiddleParams,
): Promise<void> {
  const {
    dir,
    enableElectronLogging,
    isValidBuild,
    localPath,
    options,
    version,
  } = params;

  const env = { ...process.env };

  if (enableElectronLogging) {
    env.ELECTRON_ENABLE_LOGGING = 'true';
    env.ELECTRON_DEBUG_NOTIFICATIONS = 'true';
    env.ELECTRON_ENABLE_STACK_DUMPING = 'true';
  } else {
    delete env.ELECTRON_ENABLE_LOGGING;
    delete env.ELECTRON_DEBUG_NOTIFICATIONS;
    delete env.ELECTRON_ENABLE_STACK_DUMPING;
  }

  Object.assign(env, params.env);

  let childProcesses = fiddleProcesses.get(webContents);
  if (childProcesses) {
    childProcesses.abortController = new AbortController();
  } else {
    childProcesses = {
      abortController: new AbortController(),
      hostApp: null,
      RNCLI: null,
    };
    fiddleProcesses.set(webContents, childProcesses);
  }

  const pushOutput = (data: string | Buffer) => {
    ipcMainManager.send(
      IpcEvents.FIDDLE_RUNNER_OUTPUT,
      [data.toString()],
      webContents,
    );
  };

  // This is a bit fragile, but I'm not clear that there is any first-class way
  // to get the template directory (that contains the real node_modules)
  // otherwise.
  //
  // Also: apologies for the poor variable names. React Native Fiddle uses at
  // least four different locations for templates:
  // 1. The download from the react-native-fiddle-repro repo, in:
  //    ~/Library/Application Support/React Native Fiddle/Templates/react-native-fiddle-repro-0-x-y
  // 2. The "source", stored in a temporary dir, e.g.:
  //    /private/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/react-native-fiddle-92608-0MCpHD4jYdhV
  // 3. The "local copy", stored in the Caches dir, e.g.:
  //    ~/Library/Caches/fiddle-core/fiddles/102ca20d3c7d06bb3f74202afcaf2bb1
  // 4. The user-saved copy, stored wherever the user chooses.
  // … I'm not really clear of the reasoning! All I can say is that only (1)
  // contains a node_modules.
  const templateDirContainingRealNodeModules = getCurrentTemplateDir();

  // React Native Fiddle logs out these debug logs:
  // > - fiddle:
  // >     - source: /private/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/react-native-fiddle-92608-0MCpHD4jYdhV
  // >     - local copy: /Users/jamie/Library/Caches/fiddle-core/fiddles/102ca20d3c7d06bb3f74202afcaf2bb1
  // They come from: node_modules/@electron/fiddle-core/dist/runner.js
  //
  // params.localPath and params.options[0] both give the fiddle source logged
  // out above.
  const templateDirLackingNodeModules = dir;
  console.log(
    `[CWD] window.ElectronFiddle.startFiddle() shall serve from params.dir "${templateDirLackingNodeModules}".${params.localPath ? ` params.localPath was "${params.localPath}".` : ''}`,
  );

  // This is a copy of the internal logic of runner.spawn(), with an
  // afterCreate() hook added in.
  const hostApp = await spawnRunner({
    signal: childProcesses.abortController.signal,
    runner: runner as unknown as RunnerWithPrivates,
    versionIn:
      isValidBuild && localPath ? Installer.getExecPath(localPath) : version,
    fiddleIn: dir,
    opts: { args: options, cwd: dir, env },

    // We use this hook to install the node modules immediately after calling
    // runner.fiddleFactory.create() (the function that takes a "local copy" of
    // the temporary folder). Otherwise, the copy ends up including the node
    // modules, which weigh around 400 MB and take 11 seconds to write.
    afterCreate: async () => {
      await installNodeModulesForTemplate({
        templateDirContainingRealNodeModules,
        templateDirLackingNodeModules,
        signal: childProcesses.abortController.signal,
        pushOutput,
        webContents,
      });

      // We also launch the RNCLI dev server during this hook, as launching it
      // after the runner's spawn() call would lead to the host app waking to
      // find that the RNCLI dev server hasn't started up yet (and presenting a
      // red alert box).
      await new Promise<void>((resolve) => {
        restartRNCLI({
          prev: undefined,
          childProcesses,
          webContents,
          pushOutput,
          templateDirContainingRealNodeModules,
          cwd: templateDirLackingNodeModules,
          onDevServerReady: () => {
            resolve();
          },
        });
      });
    },
  });

  childProcesses.hostApp = { childProcess: hostApp };

  hostApp.stdout?.on('data', pushOutput);
  hostApp.stderr?.on('data', pushOutput);

  hostApp.on('close', async () => {
    childProcesses.hostApp = null;
    if (childProcesses.RNCLI) {
      console.log(`[CLOSE] hostApp (but waiting on RNCLI ⏳)`);
      return;
    }

    console.log(`[CLOSE] hostApp (RNCLI already closed) 👍`);

    fiddleProcesses.delete(webContents);
  });
}

function restartRNCLI({
  prev,
  childProcesses,
  webContents,
  pushOutput,
  cwd,
  templateDirContainingRealNodeModules,
  onDevServerReady,
}: {
  prev?: ChildProcess;
  childProcesses: FiddleProcessesValue;
  webContents: WebContents;
  pushOutput: (data: string | Buffer) => void;
  cwd: string;
  templateDirContainingRealNodeModules: string;
  onDevServerReady?: () => void;
}) {
  if (prev) {
    // Clean up previous RNCLI instance
    if (childProcesses.RNCLI?.type === 'running CLI') {
      childProcesses.RNCLI.removeReadyListener?.();
    }
    prev.stderr?.off('data', pushOutput);
    prev.off('error', onError);
    prev.off('close', onClose);
  }

  const next = spawn('node', ['--run', 'start'], {
    cwd,
    // If we ever want to make RNX-CLI a TTY (which might give us a mechanism
    // for invoking commands like full reload and DevTools), we can pass
    // `['inherit', 'pipe', 'pipe']` here instead, but it has the massive
    // downside of hijacking the Webpack CLI at dev time.
    stdio: 'pipe',
  });

  eventEmitter.removeAllListeners(IpcEvents.SAVED_LOCAL_FIDDLE);
  eventEmitter.addListener(IpcEvents.SAVED_LOCAL_FIDDLE, onSavedLocalFiddle);

  const RNCLI: NonNullable<FiddleProcessesValue['RNCLI']> & {
    type: 'running CLI';
  } = {
    type: 'running CLI',
    relaunchInProgress: false,
    childProcess: next,
    cwd,
  };
  childProcesses.RNCLI = RNCLI;

  if (next.stdout) {
    const rl = readline.createInterface({ input: next.stdout });

    let reconnectState:
      | { type: 'not reconnected' }
      | { type: 'reconnecting'; revert: () => void }
      | { type: 'reconnected'; value: ChildProcess } = {
      type: 'not reconnected',
    };

    const onLine = async (line: string) => {
      pushOutput(line);

      // https://github.com/microsoft/rnx-kit/commit/414230431b16dbd562830104a27129d8c159c1b6
      if (!line.includes('Dev server is listening on')) {
        // RNCLI hasn't started running the Metro dev server yet.
        return;
      }

      onDevServerReady?.();

      // Trigger automatic reconnection to the new RNCLI instance.

      if (!prev) {
        // This is the 'first' RNCLI instance, rather than a 'new' once, so no
        // need to reconnect; it'll connect by itself.
        return;
      }

      const { abortController, hostApp } = childProcesses;
      if (!hostApp?.childProcess || abortController.signal.aborted) {
        // No host app, no point in triggering a reconnect.
        return;
      }

      if (
        reconnectState.type === 'reconnected' &&
        reconnectState.value === next
      ) {
        // Suppressing auto-reconnect, as already reconnected.
        return;
      }

      if (reconnectState.type === 'reconnecting') {
        // Suppressing auto-reconnect, as an attempt is already in-flight.
        return;
      }

      const lastreconnectState = reconnectState;
      reconnectState = {
        type: 'reconnecting',
        revert: () => {
          reconnectState = lastreconnectState;
        },
      };

      if (platform !== 'darwin') {
        console.warn(
          'Automatic reconnecting to RNCLI only implemented on macOS. Please perform `Right-click > Reload` on the host app to reconnect.',
        );
        reconnectState.revert();
        return;
      }

      const { spawnfile } = hostApp.childProcess;
      const infoPlist = path.resolve(spawnfile, '../../Info.plist');
      let bundleId: string;
      try {
        const { stdout } = await execPromise(
          `defaults read "${infoPlist}" CFBundleIdentifier`,
        );
        bundleId = stdout.trim();
      } catch (error) {
        console.error(
          'Unable to trigger a reload, as unable to determine the CFBundleIdentifier of the hostApp',
          error,
        );
        reconnectState.revert();
        return;
      }

      const triggerReloadFile = path.resolve(
        homedir(),
        `Library/Application Support/${bundleId}/trigger-reload.txt`,
      );

      console.log('Triggering reconnect to the new RNCLI instance...');
      try {
        // Writing any change will do.
        await fsPromises.writeFile(triggerReloadFile, new Date().toJSON());
      } catch (error) {
        console.error(
          'Failed to trigger a reconnect to the new RNCLI instance. Please perform `Right-click > Reload` on the host app to reconnect.',
          error,
        );
        reconnectState.revert();
        return;
      }
      console.log('... Triggered reconnect to the new RNCLI instance!');

      // We can't examine what happens from here, so just have to assume that
      // the trigger led to a successful reload (or in any case, that any
      // further attempts would be futile).
      reconnectState = { type: 'reconnected', value: next };
    };

    rl.on('line', onLine);
    RNCLI.removeReadyListener = () => {
      rl.off('line', onLine);
      RNCLI.removeReadyListener = undefined;
    };
  }
  next.stderr?.on('data', pushOutput);
  next.on('error', onError);
  next.on('close', onClose);

  function onClose() {
    if (
      childProcesses.RNCLI?.type === 'running CLI' &&
      childProcesses.RNCLI.relaunchInProgress
    ) {
      console.log(`[CLOSE] RNCLI (closing due to relaunch) ♻️`);
      return;
    }

    childProcesses.RNCLI = null;
    if (childProcesses.hostApp) {
      console.log(`[CLOSE] RNCLI (but waiting on hostApp ⏳)`);
      return;
    }

    console.log(`[CLOSE] RNCLI (hostApp already closed) 👍`);

    fiddleProcesses.delete(webContents);
  }

  function onError(error: Error) {
    console.error('[RNCLI] error', error);
  }

  async function onSavedLocalFiddle(dirname: string) {
    console.log(
      `[CWD] window.ElectronFiddle.restartRNCLI() > onSavedLocalFiddle() shall serve "${dirname}"`,
    );
    const RNCLI = childProcesses.RNCLI;
    if (!RNCLI) {
      return;
    }

    const rnCliCwd = RNCLI.cwd;
    if (!rnCliCwd) {
      return;
    }

    if (path.resolve(dirname) === path.resolve(rnCliCwd)) {
      console.log(
        `[IpcEvents.SAVED_LOCAL_FIDDLE] dirname "${dirname}" unchanged, so keeping Metro CLI as-is.`,
      );
      return;
    }

    console.log(
      `[IpcEvents.SAVED_LOCAL_FIDDLE] dirname "${dirname}" changed, so relaunching Metro CLI in new CWD...`,
    );

    const { pid } = RNCLI.childProcess;
    if (!pid) {
      return;
    }
    if (pid) {
      const retry = async (): Promise<'Cancel' | 'Continue'> => {
        if (RNCLI.type !== 'running CLI') {
          throw new Error("Expected RNCLI to be in 'running CLI' state.");
        }

        RNCLI.relaunchInProgress = true;

        try {
          await killChildProcess(RNCLI.childProcess, 'RNCLI');
          return 'Continue';
        } catch (error) {
          const buttons = ['Retry', 'Cancel'] as const;
          const { response } = await dialog.showMessageBox({
            type: 'error',
            message:
              "Unable to terminate React Native CLI process. Click 'Retry' to try terminating it again, or 'Cancel' in case you have any unsaved work to save before quitting manually.",
            detail: error instanceof Error ? error.message : undefined,
            buttons: buttons as unknown as string[],
          });

          const choice = buttons[response] ?? 'Cancel';
          return choice === 'Retry' ? await retry() : choice;
        } finally {
          RNCLI.relaunchInProgress = false;
        }
      };

      const result = await retry();
      switch (result) {
        case 'Cancel': {
          console.log(
            `[IpcEvents.SAVED_LOCAL_FIDDLE] Unable to terminate React Native CLI process, so cancelling relaunch.`,
          );
          return;
        }
        case 'Continue': {
          console.log(
            `[IpcEvents.SAVED_LOCAL_FIDDLE] relaunching Metro CLI in new CWD: "${dirname}"`,
          );
          break;
        }
      }
    } else {
      console.log(
        `[IpcEvents.SAVED_LOCAL_FIDDLE] previous childProcess lacked pid, so no process termination needed. Relaunching Metro CLI in new CWD: "${dirname}"`,
      );
    }

    /**
     * We have a node_modules folder in our original template, but manually
     * saved templates omit it for some reason, so we'll copy them over.
     */
    await installNodeModulesForTemplate({
      signal: childProcesses.abortController.signal,
      templateDirContainingRealNodeModules,
      templateDirLackingNodeModules: dirname,
      pushOutput,
      webContents,
    });

    restartRNCLI({
      prev: next,
      childProcesses,
      webContents,
      pushOutput,
      cwd: dirname,
      templateDirContainingRealNodeModules,
    });
  }
}

/**
 * A copy of the internals of runner.spawn(), but with extra hooks for doing
 * stuff in between steps, and support for aborting.
 */
async function spawnRunner({
  signal,
  runner,
  versionIn,
  fiddleIn,
  afterCreate,
  opts = {},
}: {
  signal?: AbortSignal;
  runner: RunnerWithPrivates;
  versionIn: string | SemVer;
  fiddleIn: FiddleSource;
  /**
   * A custom hook to be run immediately after runner.fiddleFactory.create().
   */
  afterCreate?: () => Promise<void>;
  opts?: RunnerSpawnOptions;
}) {
  const DefaultRunnerOpts = {
    args: [],
    headless: false,
    out: process.stdout,
    showConfig: true,
  };

  opts = { ...DefaultRunnerOpts, ...opts };
  const version = versionIn instanceof SemVer ? versionIn.version : versionIn;
  const fiddle = await runner.fiddleFactory.create(fiddleIn, {
    packAsAsar: opts.runFromAsar,
  });
  if (!fiddle) throw new Error(`Invalid fiddle: "${inspect(fiddleIn)}"`);

  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

  await afterCreate?.();

  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

  const electronExec = await runner.getExec(version);

  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

  let exec = electronExec;
  let args = [...(opts.args || []), fiddle.mainPath];
  if (opts.headless) {
    ({ exec, args } = (Runner as unknown as TypeofRunnerWithPrivates).headless(
      exec,
      args,
    ));
  }

  if (opts.out && opts.showConfig) {
    opts.out.write(`${runner.spawnInfo(version, electronExec, fiddle)}\n`);
  }
  const child = spawn(exec, args, opts);
  if (opts.out) {
    child.stdout?.pipe(opts.out);
    child.stderr?.pipe(opts.out);
  }
  return child;
}

type RunnerWithPrivates = Omit<Runner, 'fiddleFactory' | 'getExec'> & {
  fiddleFactory: FiddleFactory;
  getExec(electron: import('node:fs').PathLike): Promise<string>;
  spawnInfo: (version: string, exec: string, fiddle: Fiddle) => string;
};
type TypeofRunnerWithPrivates = Omit<typeof Runner, 'headless'> & {
  headless(
    exec: string,
    args: Array<string>,
  ): {
    exec: string;
    args: Array<string>;
  };
};

/**
 * We have a node_modules folder in our original template, but manually saved
 * templates omit it for some reason, so we'll copy them over (which will be
 * faster than an `npm install`).
 */
async function installNodeModulesForTemplate({
  templateDirLackingNodeModules,
  webContents,
  signal,
  pushOutput,
}: {
  templateDirContainingRealNodeModules: string;
  templateDirLackingNodeModules: string;
  webContents: WebContents;
  signal?: AbortSignal;
  pushOutput: (data: string | Buffer) => void;
}) {
  const packageManager =
    (await getPreferredPackageManager(webContents)) ?? 'npm';
  pushOutput(
    `Installing node modules for template using ${packageManager}${packageManager === 'bun' ? '' : ' (for faster installs, we recommend configuring Bun as your package manager in Settings > Execution)'}. This may take a few seconds…`,
  );

  return await addModulesWithFeedback({
    dir: templateDirLackingNodeModules,
    packageManager,
    signal,
    onStdOutLine: pushOutput,
    onStdErrLine: pushOutput,
  });
}

/**
 * Stop a currently running React Native fiddle.
 */
export async function stopFiddle(
  webContents: WebContents,
): Promise<{ hostAppResult: ChildKillResult; RNCLIResult: ChildKillResult }> {
  eventEmitter.removeAllListeners(IpcEvents.SAVED_LOCAL_FIDDLE);

  const childProcesses = fiddleProcesses.get(webContents);
  if (!childProcesses) {
    console.log(`[stopFiddle] bailing because no childProcesses`);
    return {
      hostAppResult: {
        type: 'resolve',
        result: { code: null, signal: null },
      },
      RNCLIResult: {
        type: 'resolve',
        result: { code: null, signal: null },
      },
    };
  }

  const { hostApp, RNCLI } = childProcesses;

  let hostAppPromise: Promise<ChildKillResult>;
  if (hostApp?.childProcess) {
    hostAppPromise = killChildProcess(hostApp.childProcess, 'hostApp')
      .then((result) => ({ type: 'resolve' as const, result }))
      .catch((error) => ({ type: 'reject' as const, error }));
  } else {
    if (!hostApp) {
      console.log(`[stopFiddle] hostApp.childProcess was nullish.`);
    }
    hostAppPromise = Promise.resolve({
      type: 'resolve',
      result: { code: null, signal: null },
    });
  }

  let RNCLIPromise: Promise<ChildKillResult>;
  if (RNCLI?.childProcess) {
    RNCLIPromise = killChildProcess(RNCLI.childProcess, 'RNCLI')
      .then((result) => ({ type: 'resolve' as const, result }))
      .catch((error) => ({ type: 'reject' as const, error }));
  } else {
    console.log(`[stopFiddle] RNCLI.childProcess was nullish.`);
    RNCLIPromise = Promise.resolve({
      type: 'resolve',
      result: { code: null, signal: null },
    });
  }

  // Abort any of the tasks that happen before child process initialisation
  // (e.g. creating the FiddleFactory, getting the Electron exec, and installing
  // the node modules).
  childProcesses.abortController.abort('User stopped fiddle');

  const [hostAppResult, RNCLIResult] = await Promise.all([
    hostAppPromise,
    RNCLIPromise,
  ]);

  console.log(`[stopFiddle] all done!`);

  return { hostAppResult, RNCLIResult };
}

/**
 * The "reject" path is not currently used (in all illegal states, resolving
 * `{ code: null, signal: null })` seems reasonable enough). But it's a bigger
 * refactor to change our mind in future, so I'm keeping it in.
 */
type ChildKillResult =
  | {
      type: 'resolve';
      result: { code: number | null; signal: NodeJS.Signals | null };
    }
  | { type: 'reject'; error: unknown };

async function killChildProcess(
  child: ChildProcess,
  type: 'RNCLI' | 'hostApp',
) {
  const { pid } = child;
  if (typeof pid !== 'number') {
    console.log(
      `Child process for type ${type} lacked pid, so (unexpectedly) failed to spawn in the first place.`,
    );

    return { code: child.exitCode, signal: child.signalCode };
  }

  return await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>(async (resolve) => {
    child.once('close', (code, signal) => {
      console.log(
        `[stopFiddle] Got 'close' event for ${type}. Code: ${code}. Signal ${signal}.`,
      );
      clearTimeout(sigKillTimeout);
      resolve({ code, signal });
    });

    if (type === 'RNCLI' && platform === 'darwin') {
      let metroPid: number | undefined;
      try {
        // Amazingly, even tree-killing RNCLI doesn't seem to be enough, as the
        // Metro server continues to run on 8081 undeterred. I guess it's run as
        // a forked process. As such, let's hunt it down by its port.
        const { stdout } = await execPromise('lsof -i :8081');
        const lines = stdout.split('\n');
        const metroProcess = lines.find((line) => line.startsWith('node'));
        if (metroProcess) {
          const match = /node\s+(\d+)/.exec(metroProcess);
          const matchedPid = match?.at(1);
          if (matchedPid) {
            const parsedPid = Number.parseInt(matchedPid);
            if (!Number.isNaN(parsedPid)) {
              metroPid = parsedPid;
            }
          }
        }
      } catch (error) {
        console.error(
          `Unable to identify Metro process, so may not have any luck properly killing the RNCLI.`,
          error,
        );
      }

      if (typeof metroPid === 'number') {
        try {
          await execPromise(`kill ${metroPid}`);
          console.log(`Killed Metro pid ${metroPid}.`);
        } catch (error) {
          console.error(`Error trying to kill the Metro pid.`, error);
        }
      }
    }

    treeKill(pid, 'SIGTERM');

    const sigKillTimeout = setTimeout(() => {
      if (child.exitCode !== null) {
        // Handle the imaginary case that we beat the 'close' listener in a
        // race.
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }

      console.log(
        `[stopFiddle] tree kill of ${type} wasn't enough, so will SIGKILL`,
      );
      treeKill(pid, 'SIGKILL');
    }, 1000);
  });
}

export async function setupFiddleCore(versions: ElectronVersions) {
  // For managing downloads and versions for electron
  installer = new Installer({
    electronDownloads: ELECTRON_DOWNLOAD_PATH,
    electronInstall: ELECTRON_INSTALL_PATH,
  });

  // Broadcast state changes to all windows
  installer.on('state-changed', (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      ipcMainManager.send(
        IpcEvents.VERSION_STATE_CHANGED,
        [event],
        window.webContents,
      );
    }
  });

  runner = await Runner.create({ installer, versions });

  ipcMainManager.on(
    IpcEvents.GET_VERSION_STATE,
    (event: IpcMainEvent, version: string) => {
      const normalisedVersion = normaliseMaybeDevtronValue(version);

      event.returnValue = installer.state(normalisedVersion);
    },
  );
  ipcMainManager.handle(
    IpcEvents.DOWNLOAD_VERSION,
    async (
      event: IpcMainInvokeEvent,
      version: string,
      opts?: Partial<DownloadVersionParams>,
    ) => {
      const webContents = event.sender;

      if (removingVersions.has(version)) {
        throw new Error('Version is being removed');
      }

      if (!downloadingVersions.has(version)) {
        const promise = installer.ensureDownloaded(version, {
          ...opts,
          progressCallback: (progress: ProgressObject) => {
            ipcMainManager.send(
              IpcEvents.VERSION_DOWNLOAD_PROGRESS,
              [version, progress],
              webContents,
            );
          },
        });

        downloadingVersions.set(version, promise);
      }

      try {
        await downloadingVersions.get(version);
      } finally {
        downloadingVersions.delete(version);
      }
    },
  );
  ipcMainManager.handle(
    IpcEvents.REMOVE_VERSION,
    async (_: IpcMainInvokeEvent, version: string) => {
      if (downloadingVersions.has(version)) {
        throw new Error('Version is being downloaded');
      }

      if (!removingVersions.has(version)) {
        removingVersions.set(version, installer.remove(version));
      }

      try {
        await removingVersions.get(version);
        return installer.state(version);
      } finally {
        removingVersions.delete(version);
      }
    },
  );
  ipcMainManager.handle(
    IpcEvents.START_FIDDLE,
    async (event: IpcMainInvokeEvent, params: StartFiddleParams) => {
      try {
        await startFiddle(event.sender, params);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('START_FIDDLE was aborted.');
          return 'aborted';
        }

        throw error;
      }

      return 'started';
    },
  );
  ipcMainManager.on(IpcEvents.STOP_FIDDLE, async (event: IpcMainEvent) => {
    const { hostAppResult, RNCLIResult } = await stopFiddle(event.sender);

    let hostApp: { code: number | null; signal: string | null };
    switch (hostAppResult.type) {
      case 'resolve': {
        hostApp = hostAppResult.result;
        break;
      }
      case 'reject': {
        console.error(
          `Unexpected error when killing the host app.`,
          hostAppResult.error,
        );
        hostApp = { code: null, signal: null };
        break;
      }
    }

    let RNCLI: { code: number | null; signal: string | null };
    switch (RNCLIResult.type) {
      case 'resolve': {
        RNCLI = RNCLIResult.result;
        break;
      }
      case 'reject': {
        console.error(
          `Unexpected error when killing the host app.`,
          RNCLIResult.error,
        );
        RNCLI = { code: null, signal: null };
        break;
      }
    }

    // Triggers 'fiddle-stopped' in src/renderer/runner.ts
    ipcMainManager.send(
      IpcEvents.FIDDLE_STOPPED,
      [hostApp, RNCLI],
      event.sender,
    );
  });
}
