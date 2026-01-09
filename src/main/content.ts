import * as path from 'node:path';

import { IpcMainInvokeEvent, app } from 'electron';
import fs from 'fs-extra';

import { STATIC_DIR } from './constants';
import { eventEmitter } from './fiddle-core-inputs';
import { ipcMainManager } from './ipc';
import { addModules } from './npm';
import { readFiddle } from './utils/read-fiddle';
import { isReleasedMajor } from './versions';
import { EditorValues } from '../interfaces';
import { IpcEvents } from '../ipc-events';

// parent directory of all the downloaded template fiddles
const TEMPLATES_DIR = path.join(app.getPath('userData'), 'Templates');

// location of the fallback template fiddle used iff downloading failed
const STATIC_TEMPLATE_DIR = path.join(STATIC_DIR, 'electron-quick-start');

// electron-quick-start branch that holds the test template
const TEST_TEMPLATE_BRANCH = 'test-template';

/**
 * Ensure we have a fiddle for the specified Electron branch.
 * If we don't have it already, download it from the minimal-repro
 * repository.
 *
 * @param branch - Electron branchname, e.g. `12-x-y` or `main`
 * @returns Path to the folder where the fiddle is kept
 */
async function prepareTemplate(branch: string): Promise<string> {
  let folder = path.join(TEMPLATES_DIR, `react-native-fiddle-repro-${branch}`);

  try {
    // if we don't have it, download it
    if (!fs.existsSync(folder)) {
      console.log(`Content: ${branch} downloading template`);
      const url = `https://github.com/shirakaba/react-native-fiddle-repro/archive/${branch}.zip`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url} ${response.status} ${response.statusText}`);
      }

      // save it to a tempfile
      const buffer = Buffer.from(await response.arrayBuffer());
      const { tmpNameSync } = await import('tmp');
      const tempfile = tmpNameSync({
        template: 'react-native-fiddle-XXXXXX.zip',
      });
      console.log(`Content: ${branch} saving template to "${tempfile}"`);
      await fs.writeFile(tempfile, buffer, { encoding: 'utf8' });

      // unzip it from the tempfile
      console.log(`Content: ${branch} unzipping template`);
      await fs.ensureDir(TEMPLATES_DIR);
      const { default: extract } = await import('extract-zip');
      await extract(tempfile, { dir: TEMPLATES_DIR });

      /**
       * Install its node modules.
       *
       * This step is unique to React Native Fiddle, as the default Electron
       * Fiddle template (minimal-repro-39-x-y) can get by without dependencies.
       * More precisely, it consists only of:
       *
       * ```json
       * "devDependencies": {
       *   "electron": "^39.1.2"
       * }
       * ```
       *
       * If saved to your chosen directory, this is preserved (but `npm install`
       * is skipped, I think because the 'electron' dependency is a hard-coded
       * exception given that electron-bin delivers the Electron.app that it's
       * depended on for).
       *
       * If saved to the temporary directory (which happens when you click Run
       * without having done an initial save), you can even see this quirk of
       * skipping the 'electron' dependency more directly as it rewrites
       * package.json as follows:
       *
       * ```json
       * "dependencies": {},
       * "devDependencies": {}
       * ```
       *
       * As our React Native Fiddle templates will always require an
       * `npm install` (we bundle in dev mode and need the 'react-native'
       * package at runtime), we have to diverge from the way Electron Fiddle
       * does things. We'll run an `npm install` during prepareTemplate() and
       * copy that installation across whether saving to a chosen directory or a
       * temporary directory.
       */
      await addModules({ dir: folder, packageManager: 'npm' });

      // cleanup
      console.log(`Content: ${branch} unzipped; removing "${tempfile}"`);
      await fs.remove(tempfile);
    }
  } catch (err) {
    folder = STATIC_TEMPLATE_DIR;
    console.log(`Content: ${branch} failed; using ${folder}`, err);
  }

  return folder;
}

const templateCache: Record<string, Promise<EditorValues>> = {};

/**
 * Get a cached copy of the Electron branch's fiddle.
 *
 * @param branch - Electron branchname, e.g. `12-x-y` or `main`
 */
function getQuickStart(branch: string): Promise<EditorValues> {
  // Load the template for that branch.
  // Cache the work in a Promise to prevent parallel downloads.
  let pending = templateCache[branch];
  if (!pending) {
    console.log(`Content: ${branch} template loading`);
    pending = prepareTemplate(branch).then((folder) => {
      eventEmitter.emit('add-template', branch, folder);
      // JB: modified to `includePackageJson: true`
      return readFiddle(folder, true);
    });
    templateCache[branch] = pending;
  }
  return pending;
}

/**
 * Get a cached copy of the Electron Test fiddle.
 */
export function getTestTemplate(): Promise<EditorValues> {
  return getQuickStart(TEST_TEMPLATE_BRANCH);
}

/**
 * Get a cached copy of the fiddle for the specified Electron version.
 *
 * @param version - Electron version, e.g. 12.0.0
 */
export function getTemplate(version: string): Promise<EditorValues> {
  const major = Number.parseInt(version);
  return isReleasedMajor(major)
    ? getQuickStart(`${major}-x-y`)
    : // JB: modified to `includePackageJson: true`
      readFiddle(STATIC_TEMPLATE_DIR, true);
}

export async function setupContent() {
  ipcMainManager.handle(
    IpcEvents.GET_TEMPLATE,
    async (_: IpcMainInvokeEvent, version: string) => {
      const major = Number.parseInt(version);
      const branch = `${major}-x-y`;

      const editorValues = await getTemplate(version);
      eventEmitter.emit('set-current-template', branch);
      return editorValues;
    },
  );
  ipcMainManager.handle(IpcEvents.GET_TEST_TEMPLATE, (_: IpcMainInvokeEvent) =>
    getTestTemplate(),
  );
}
