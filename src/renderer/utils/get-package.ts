import * as fiddlePackageJSON from '../../../package.json';
import { PackageJsonOptions } from '../../interfaces';
import { AppState } from '../../renderer/state';

export const DEFAULT_OPTIONS = {
  includeElectron: true,
  includeDependencies: true,
};

export function getForgeVersion(): string {
  return fiddlePackageJSON.devDependencies['@electron-forge/cli'];
}

/**
 * Returns the package.json for the current Fiddle
 */
export async function getPackageJson(
  appState: AppState,
  options?: PackageJsonOptions,
): Promise<string> {
  const { includeElectron, includeDependencies } = options || DEFAULT_OPTIONS;
  const name = await appState.getName();

  const devDependencies: Record<string, string> = {};
  const dependencies: Record<string, string> = {};

  if (includeElectron) {
    dependencies['react-native-macos'] = appState.version;
  }

  if (includeDependencies) {
    const { modules } = appState;
    for (const [module, version] of modules.entries()) {
      dependencies[module] = version;
    }
  }

  // This is the package.json that will be written when you save a Fiddle to
  // disk. It should mirror the contents of shirakaba/react-native-fiddle-repro
  // (which itself is a fork of electron/minimal-repro).
  //
  // While we don't have a practical way to keep the dependencies in sync (as
  // that aspect of the template is ever-updating), they don't technically
  // matter because we symlink back to the node_modules of the actual template
  // anyway.
  //
  // The repos can be found here, though remember that the branch matters. In
  // the case of react-native-fiddle-repro, until React Native makes it to v1,
  // we'll be loading from the 0-x-y branch.
  // - https://github.com/shirakaba/react-native-fiddle-repro
  // - https://github.com/electron/minimal-repro
  return JSON.stringify(
    {
      name,
      productName: name,
      description: 'A minimal React Native application',
      version: '1.0.0',
      author: appState.packageAuthor,
      scripts: {
        start: 'rnx-cli start --custom-log-reporter-path ./reporter.js',
      },
      dependencies,
      devDependencies,
    },
    undefined,
    2,
  );
}
