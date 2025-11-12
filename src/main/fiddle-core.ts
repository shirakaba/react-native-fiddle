import { ChildProcess, spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import fsPromises from 'node:fs/promises';
import * as path from 'node:path';

import { ElectronVersions, Installer, Runner } from '@electron/fiddle-core';
import {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  dialog,
} from 'electron';

import { ELECTRON_DOWNLOAD_PATH, ELECTRON_INSTALL_PATH } from './constants';
import { ipcMainManager } from './ipc';
import { treeKill } from './tree-kill';
import {
  DownloadVersionParams,
  ProgressObject,
  StartFiddleParams,
} from '../interfaces';
import { IpcEvents } from '../ipc-events';

let installer: Installer;
let runner: Runner;
export const eventEmitter = new EventEmitter();

// Keep track of which fiddle process belongs to which WebContents
const fiddleProcesses = new WeakMap<WebContents, FiddleProcessesValue>();
type FiddleProcessesValue = {
  hostApp: { childProcess: ChildProcess } | null;
  RNCLI: {
    childProcess: ChildProcess;
    cwd: string;
    onSavedLocalFiddle: (dirname: string) => void;
  } | null;
};

const downloadingVersions = new Map<string, Promise<any>>();
const removingVersions = new Map<string, Promise<void>>();

/**
 * Start running an Electron fiddle.
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

  const hostApp = await runner.spawn(
    isValidBuild && localPath ? Installer.getExecPath(localPath) : version,
    dir,
    { args: options, cwd: dir, env },
  );

  let childProcesses = fiddleProcesses.get(webContents);
  if (!childProcesses) {
    childProcesses = { hostApp: null, RNCLI: null };
  }
  childProcesses.hostApp = { childProcess: hostApp };

  const pushOutput = (data: string | Buffer) => {
    ipcMainManager.send(
      IpcEvents.FIDDLE_RUNNER_OUTPUT,
      [data.toString()],
      webContents,
    );
  };

  hostApp.stdout?.on('data', pushOutput);
  hostApp.stderr?.on('data', pushOutput);

  hostApp.on('close', async (code, signal) => {
    childProcesses.hostApp = null;
    if (childProcesses.RNCLI) {
      console.log(`[CLOSE] hostApp (but waiting on RNCLI ⏳)`);
      return;
    }

    console.log(`[CLOSE] hostApp (RNCLI already closed) 👍`);

    fiddleProcesses.delete(webContents);
    ipcMainManager.send(IpcEvents.FIDDLE_STOPPED, [code, signal], webContents);
  });

  const templateCwd =
    '/Users/jamie/Library/Application Support/Electron Fiddle/Templates/react-native-fiddle-repro-0-x-y';

  restartRNCLI({
    prev: undefined,
    childProcesses,
    webContents,
    pushOutput,
    templateCwd,
    cwd: templateCwd,
  });
}

function restartRNCLI({
  prev,
  childProcesses,
  webContents,
  pushOutput,
  cwd,
  templateCwd,
}: {
  prev?: ChildProcess;
  childProcesses: FiddleProcessesValue;
  webContents: WebContents;
  pushOutput: (data: string | Buffer) => void;
  cwd: string;
  templateCwd: string;
}) {
  if (prev) {
    // Clean up previous RNCLI instance
    prev.stdout?.on('data', pushOutput);
    prev.stderr?.on('data', pushOutput);
    prev.on('error', onError);
    prev.on('close', onClose);
    eventEmitter.removeListener(
      IpcEvents.SAVED_LOCAL_FIDDLE,
      onSavedLocalFiddle,
    );
  }

  const next = spawn('node', ['--run', 'start'], {
    cwd,
    stdio: 'pipe',
  });
  eventEmitter.addListener(IpcEvents.SAVED_LOCAL_FIDDLE, onSavedLocalFiddle);

  childProcesses.RNCLI = {
    childProcess: next,
    cwd,
    onSavedLocalFiddle,
  };

  next.stdout?.on('data', pushOutput);
  next.stderr?.on('data', pushOutput);
  next.on('error', onError);
  next.on('close', onClose);

  function onClose(code: number | null, signal: NodeJS.Signals | null) {
    childProcesses.RNCLI = null;
    if (childProcesses.hostApp) {
      console.log(`[CLOSE] RNCLI (but waiting on hostApp ⏳)`);
      return;
    }

    console.log(`[CLOSE] RNCLI (hostApp already closed) 👍`);

    fiddleProcesses.delete(webContents);
    ipcMainManager.send(IpcEvents.FIDDLE_STOPPED, [code, signal], webContents);
  }

  function onError(error: Error) {
    console.error('[RNCLI] error', error);
  }

  async function onSavedLocalFiddle(dirname: string) {
    console.log('[IpcEvents.SAVED_LOCAL_FIDDLE] dirname:', dirname);
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
        try {
          await new Promise<void>((resolve, reject) => {
            treeKill(pid, 'SIGTERM', (error?: Error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
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
     * saved templates omit it for some reason, so we'll symlink back to it.
     */
    const nodeModulesTarget = path.resolve(templateCwd, 'node_modules');
    const symlinkPath = path.resolve(dirname, 'node_modules');
    try {
      await fsPromises.symlink(nodeModulesTarget, symlinkPath, 'dir');
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !('code' in cause) ||
        cause.code !== 'EEXIST'
      ) {
        throw new Error('Unable to symlink node_modules into save location', {
          cause,
        });
      }
    }

    restartRNCLI({
      prev: next,
      childProcesses,
      webContents,
      pushOutput,
      cwd: dirname,
      templateCwd,
    });
  }
}

/**
 * Stop a currently running Electron fiddle.
 */
export function stopFiddle(webContents: WebContents): void {
  const childProcesses = fiddleProcesses.get(webContents);
  if (!childProcesses) {
    return;
  }

  for (const child of [
    childProcesses.RNCLI?.childProcess,
    childProcesses.hostApp?.childProcess,
  ].filter((childProcess) => !!childProcess)) {
    if (typeof child.pid !== 'number') {
      continue;
    }

    // Although child.kill() is sufficient for killing the hostApp child
    // process, to kill RNCLI, it is necessary to kill its grandchild processes
    // (i.e. the Metro bundler) too, hence we have to bring in treeKill().
    treeKill(child.pid, 'SIGTERM');

    // If the child process is still alive 1 second after we've
    // attempted to kill it by normal means, kill it forcefully.
    setTimeout(() => {
      if (child.exitCode === null) {
        if (typeof child.pid !== 'number') {
          return;
        }
        treeKill(child.pid, 'SIGKILL');
      }
    }, 1000);
  }

  if (childProcesses.RNCLI?.onSavedLocalFiddle) {
    eventEmitter.removeListener(
      IpcEvents.SAVED_LOCAL_FIDDLE,
      childProcesses.RNCLI.onSavedLocalFiddle,
    );
  }
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
      const normalisedVersion =
        '__uuid__devtron' in (version as unknown as { args: [string] })
          ? (version as unknown as { args: [string] }).args[0]
          : version;

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
      await startFiddle(event.sender, params);
    },
  );
  ipcMainManager.on(IpcEvents.STOP_FIDDLE, (event: IpcMainEvent) => {
    stopFiddle(event.sender);
  });
}
