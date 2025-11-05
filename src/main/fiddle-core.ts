import { ChildProcess, spawn } from 'node:child_process';

import { ElectronVersions, Installer, Runner } from '@electron/fiddle-core';
import {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';

import { ELECTRON_DOWNLOAD_PATH, ELECTRON_INSTALL_PATH } from './constants';
import { ipcMainManager } from './ipc';
import {
  DownloadVersionParams,
  ProgressObject,
  StartFiddleParams,
} from '../interfaces';
import { IpcEvents } from '../ipc-events';

let installer: Installer;
let runner: Runner;

// Keep track of which fiddle process belongs to which WebContents
const fiddleProcesses = new WeakMap<WebContents, Set<ChildProcess>>();

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

  const RNCLI = spawn('node', ['--run', 'start'], {
    cwd: '/Users/jamie/Library/Application Support/Electron Fiddle/Templates/react-native-fiddle-repro-0-x-y',
    stdio: 'pipe',
  });

  let childProcesses = fiddleProcesses.get(webContents);
  if (!childProcesses) {
    childProcesses = new Set<ChildProcess>();
    fiddleProcesses.set(webContents, childProcesses);
  }
  childProcesses.add(hostApp);
  childProcesses.add(RNCLI);

  const pushOutput = (data: string | Buffer) => {
    ipcMainManager.send(
      IpcEvents.FIDDLE_RUNNER_OUTPUT,
      [data.toString()],
      webContents,
    );
  };

  hostApp.stdout?.on('data', pushOutput);
  hostApp.stderr?.on('data', pushOutput);

  RNCLI.stdout?.on('data', pushOutput);
  RNCLI.stderr?.on('data', pushOutput);
  RNCLI.on('error', (error) => {
    console.error('[RNCLI] error', error);
  });

  hostApp.on('close', async (code, signal) => {
    childProcesses.delete(hostApp);
    if (childProcesses.size) {
      return;
    }

    fiddleProcesses.delete(webContents);
    ipcMainManager.send(IpcEvents.FIDDLE_STOPPED, [code, signal], webContents);
  });

  RNCLI.on('close', (code, signal) => {
    childProcesses.delete(RNCLI);
    if (childProcesses.size) {
      return;
    }

    fiddleProcesses.delete(webContents);
    ipcMainManager.send(IpcEvents.FIDDLE_STOPPED, [code, signal], webContents);
  });
}

/**
 * Stop a currently running Electron fiddle.
 */
export function stopFiddle(webContents: WebContents): void {
  const childProcesses = fiddleProcesses.get(webContents);
  if (!childProcesses) {
    return;
  }
  for (const child of childProcesses) {
    child?.kill();

    if (child) {
      // If the child process is still alive 1 second after we've
      // attempted to kill it by normal means, kill it forcefully.
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 1000);
    }
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
