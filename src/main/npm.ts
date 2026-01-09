import * as path from 'node:path';

import { IpcMainInvokeEvent, WebContents, shell } from 'electron';

import { ipcMainManager } from './ipc';
import { exec, spawn } from './utils/exec';
import { IPackageManager, PMOperationOptions } from '../interfaces';
import { IpcEvents } from '../ipc-events';

let isNpmInstalled: boolean | null = null;
let isYarnInstalled: boolean | null = null;
let isBunInstalled: boolean | null = null;

/**
 * Checks if package manager is installed by checking if a binary
 * with that name can be found.
 */
export async function getIsPackageManagerInstalled(
  packageManager: IPackageManager,
  ignoreCache?: boolean,
): Promise<boolean> {
  if (packageManager === 'npm' && isNpmInstalled !== null && !ignoreCache)
    return isNpmInstalled;
  if (packageManager === 'yarn' && isYarnInstalled !== null && !ignoreCache)
    return isYarnInstalled;
  if (packageManager === 'bun' && isBunInstalled !== null && !ignoreCache)
    return isBunInstalled;

  const command =
    process.platform === 'win32'
      ? `where.exe ${packageManager}`
      : `which ${packageManager}`;

  try {
    await exec(process.cwd(), command);
    if (packageManager === 'npm') {
      isNpmInstalled = true;
    } else if (packageManager === 'bun') {
      isBunInstalled = true;
    } else {
      isYarnInstalled = true;
    }
    return true;
  } catch (error) {
    console.warn(`getIsPackageManagerInstalled: "${command}" failed.`, error);
    if (packageManager === 'npm') {
      isNpmInstalled = false;
    } else if (packageManager === 'bun') {
      isBunInstalled = false;
    } else {
      isYarnInstalled = false;
    }
    return false;
  }
}

/**
 * Gets the preferred package manager by checking the user's preference stored
 * into localStorage. If no preference has been stored, returns `null`.
 */
export async function getPreferredPackageManager(
  webContents: WebContents,
): Promise<IPackageManager | null> {
  const value = await webContents.executeJavaScript(
    'localStorage.getItem("packageManager")',
  );
  if (value !== 'npm' && value !== 'yarn' && value !== 'bun') {
    return null;
  }

  return value;
}

/**
 * Installs given modules to a given folder.
 */
export async function addModules(
  { dir, packageManager }: PMOperationOptions,
  ...names: Array<string>
): Promise<string> {
  const { command, args } = addModulesPrelude(packageManager, ...names);

  return exec(dir, [command].concat(args).join(' '));
}

export async function addModulesWithFeedback(
  {
    dir,
    packageManager,
    onStdOutLine,
    onStdErrLine,
  }: PMOperationOptions & {
    onStdOutLine?: (line: string) => void;
    onStdErrLine?: (line: string) => void;
  },
  ...names: Array<string>
) {
  const { command, args } = addModulesPrelude(packageManager, ...names);

  return spawn({
    command,
    args,
    cwd: dir,
    onStdOutLine,
    onStdErrLine,
  });
}

function addModulesPrelude(packageManager: string, ...names: Array<string>) {
  let command: string;
  const args = new Array<string>();

  if (packageManager === 'npm') {
    command = 'npm';
    args.push('install');
    if (names.length > 0) {
      args.push('-S', ...names);
    } else {
      args.push('--also=dev', '--prod');
    }
  } else {
    command = packageManager;
    args.push(names.length > 0 ? 'add' : 'install', ...names);
  }

  return { command, args };
}

/**
 * Execute an "\{packageManager\} run" command
 */
export async function packageRun(
  { dir, packageManager }: PMOperationOptions,
  command: string,
): Promise<string> {
  const result = await exec(dir, `${packageManager} run ${command}`);

  shell.showItemInFolder(path.join(dir, 'out'));

  return result;
}

export async function setupNpm() {
  ipcMainManager.handle(
    IpcEvents.NPM_ADD_MODULES,
    (
      _: IpcMainInvokeEvent,
      { dir, packageManager }: PMOperationOptions,
      ...names: Array<string>
    ) => addModules({ dir, packageManager }, ...names),
  );
  ipcMainManager.handle(
    IpcEvents.NPM_IS_PM_INSTALLED,
    (
      _: IpcMainInvokeEvent,
      packageManager: IPackageManager,
      ignoreCache?: boolean,
    ) => getIsPackageManagerInstalled(packageManager, ignoreCache),
  );
  ipcMainManager.handle(
    IpcEvents.NPM_PACKAGE_RUN,
    (
      _: IpcMainInvokeEvent,
      { dir, packageManager }: PMOperationOptions,
      command: string,
    ) => packageRun({ dir, packageManager }, command),
  );
}
