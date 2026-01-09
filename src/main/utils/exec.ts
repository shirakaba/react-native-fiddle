import { exec as cp_exec } from 'node:child_process';
import { promisify } from 'node:util';

import shellEnv from 'shell-env';

/**
 * On macOS & Linux, we need to fix the $PATH environment variable
 * so that we can call `npm`.
 */
export const maybeFixPath = (() => {
  // Singleton: We don't want to do this more than once.
  let _shellPathCalled = false;

  return async (): Promise<void> => {
    if (_shellPathCalled) {
      return;
    }

    if (process.platform !== 'win32') {
      let { PATH } = await shellEnv();
      if (PATH) {
        PATH = fixVoltaPaths(PATH, process.platform as 'darwin' | 'linux');
        process.env.PATH = PATH;
      }
    }

    _shellPathCalled = true;
  };
})();

/**
 * Fix the Volta entries in a given $PATH produced by shell-env.
 *
 * shell-env is liable to reorder PATH. In my case, on macOS, it places
 * `~/.volta/tools/*` after `~/.volta/bin`, when it should be the opposite.
 *
 * The incorrect order leads to the following error upon `npm install`:
 * \> Volta error: Node is not available.
 * \> To run any Node command, first set a default version using `volta install node`
 *
 * The solution is to sort `~/.volta/tools/*` in front, as this function does.
 */
export function fixVoltaPaths(
  PATH: string,
  platform: 'win32' | 'darwin' | 'linux',
) {
  // I'd like to just use require("node:path").delimiter, but I can't see a way
  // to mock it in Vitest (same reason we take `platform` as an arg).
  let delimiter: ':' | ';';
  let voltaToolsPattern: RegExp;
  switch (platform) {
    case 'win32':
      delimiter = ';';
      voltaToolsPattern = /\\AppData\\Local\\Volta\\tools/;
      break;
    case 'darwin':
    case 'linux':
      delimiter = ':';
      voltaToolsPattern = /\/\.volta\/tools/;
      break;
  }

  const voltaTools = new Array<string>();
  const other = new Array<string>();
  for (const path of PATH.split(delimiter)) {
    if (voltaToolsPattern.test(path)) {
      voltaTools.push(path);
      continue;
    }

    other.push(path);
  }

  const result = [...voltaTools, ...other].join(delimiter);

  return result;
}

/**
 * Execute a command in a directory.
 */
export async function exec(dir: string, cliArgs: string): Promise<string> {
  await maybeFixPath();

  const { stdout } = await promisify(cp_exec)(cliArgs, {
    cwd: dir,
    maxBuffer: 200 * 1024 * 100, // 100 times the default
  });

  return stdout.trim();
}
