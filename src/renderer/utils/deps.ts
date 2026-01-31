import semver from 'semver';

import { GenericDialogType } from '../../interfaces';

export async function parseDeps(parsedJson: any) {
  const { remoteLoader } = window.app;

  const deps: Record<string, string> = {};
  const { dependencies, devDependencies } = parsedJson;
  Object.assign(deps, dependencies, devDependencies);

  // If the project specifies an Electron version, we want to tell Fiddle to run
  // it with that version by default.
  const electronDeps = Object.keys(deps).filter((d) =>
    ['electron-nightly', 'electron'].includes(d),
  );
  for (const dep of electronDeps) {
    // Strip off semver range prefixes, e.g:
    // ^1.2.0 -> 1.2.0
    // ~2.3.4 -> 2.3.4
    const index = deps[dep].search(/\d/);
    const version = deps[dep].substring(index);

    if (!semver.valid(version)) {
      await window.app.state.showGenericDialog({
        label: `The Electron version (${version}) in this Fiddle's package.json is invalid. Falling back to last used version.`,
        ok: 'Close',
        type: GenericDialogType.warning,
        wantsInput: false,
      });
    } else {
      remoteLoader.setElectronVersion(version);
    }

    // We want to include all dependencies except Electron.
    delete deps[dep];
  }

  return deps;
}
