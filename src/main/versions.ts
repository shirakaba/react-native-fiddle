import fsPromise from 'node:fs/promises';
import * as path from 'node:path';

import { ElectronVersions, Installer, SemVer } from '@electron/fiddle-core';
import debug from 'debug';
import { IpcMainInvokeEvent, app } from 'electron';
import fs from 'fs-extra';

import { ipcMainManager } from './ipc';
import releases from '../../static/releases.json';
import { InstallState, Version } from '../interfaces';
import { IpcEvents } from '../ipc-events';

let knownVersions: ElectronVersions;

Object.defineProperty(ElectronVersions, 'fetchVersions', {
  ...Object.getOwnPropertyDescriptor(ElectronVersions, 'fetchVersions'),
  value: async (cacheFile: string): Promise<unknown> => {
    const d = debug('fiddle-core:ElectronVersions:fetchVersions:overridden');
    const url = 'https://api.github.com/repos/shirakaba/rnmprebuilds/releases';
    d('fetching releases list from', url);
    const response = await fetch(url, { headers: { 'User-Agent': 'node' } });
    if (!response.ok) {
      throw new Error(
        `Fetching versions failed with status code: ${response.status}`,
      );
    }
    const json = await response.json();
    await fs.promises.mkdir(path.dirname(cacheFile), {
      recursive: true,
    });

    // Keep this mapping logic in sync with tools/fetch-releases.ts.
    const releases = new Array<unknown>();
    for (const { tag_name, published_at } of json as Array<{
      tag_name: string;
      published_at: string;
    }>) {
      if (!tag_name.startsWith('v')) {
        continue;
      }

      const date = new Date(published_at);

      // Remap:
      //   https://api.github.com/repos/shirakaba/rnmprebuilds/releases
      // ... to match the schema of:
      //   https://releases.electronjs.org/releases.json
      releases.push({
        version: tag_name.replace(/^v/, ''),
        fullDate: date.toJSON(),
        date: `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`,
        node: '22.20.0',
        v8: '14.3.96',
        uv: '1.51.0',
        zlib: '1.3.1',
        openssl: '0.0.0',
        modules: '140',
        chrome: '143.0.7477.0',
        files: [],
      });
    }

    await fsPromise.writeFile(cacheFile, JSON.stringify(releases), 'utf8');

    return releases;
  },
});

/**
 * Helper to check if this version is from a released major branch.
 *
 * This way when we have a local version of Electron like '999.0.0'
 * we'll know to not try & download 999-x-y.zip from GitHub :D
 *
 * @param major - Electron major version number
 * @returns true if there are releases with that major version
 */
export function isReleasedMajor(major: number): boolean {
  return knownVersions.inMajor(major).length > 0;
}

export function getOldestSupportedMajor(): number | undefined {
  // const NUM_BRANCHES = parseInt(process.env.NUM_STABLE_BRANCHES || '');

  // if (!Number.isNaN(NUM_BRANCHES)) {
  //   return knownVersions.stableMajors.slice(-NUM_BRANCHES)[0];
  // }

  // return knownVersions.supportedMajors[0];

  return 0;
}

export function getLatestStable(): SemVer | undefined {
  return knownVersions.latestStable;
}

export function getReleasedVersions(): Array<Version> {
  // Don't support anything older than 0.30 (Aug 2015).
  // The oldest version known to releases.json.org is 0.20,
  // Pre-0.24.0 versions were technically 'atom-shell' and cannot
  // be downloaded with @electron/get.
  // TODO(dsanders11): upstream this logic to @electron/fiddle-core
  return knownVersions.versions
    .filter((ver) => !ver.version.startsWith('0.2'))
    .map(({ version }) => ({ version }));
}

/**
 * Gets the current state of a specific version
 * Valid local electron builds are marked as `installed`
 */
export function getLocalVersionState(ver: Version): InstallState {
  const { localPath } = ver;
  if (localPath !== undefined) {
    const dir = Installer.getExecPath(localPath);
    const normalisedDir = typeof dir === 'string' ? dir : (dir as any).args[0];
    if (fs.existsSync(normalisedDir)) {
      return InstallState.installed;
    }
  }

  return InstallState.missing;
}

export async function fetchVersions(): Promise<Version[]> {
  // This relies on having patched ElectronVersions.fetchVersions() to fetch
  // from our releases mirror, which we do at the top of the file.

  await knownVersions.fetch();
  return getReleasedVersions();
}

export async function setupVersions() {
  knownVersions = await ElectronVersions.create({
    initialVersions: releases,
    paths: {
      versionsCache: path.join(app.getPath('userData'), 'releases.json'),
    },
  });

  ipcMainManager.handle(
    IpcEvents.IS_RELEASED_MAJOR,
    (_: IpcMainInvokeEvent, version: number) => isReleasedMajor(version),
  );
  ipcMainManager.handle(IpcEvents.FETCH_VERSIONS, (_: IpcMainInvokeEvent) =>
    fetchVersions(),
  );
  ipcMainManager.on(IpcEvents.GET_LATEST_STABLE, (event) => {
    event.returnValue = getLatestStable();
  });
  ipcMainManager.on(IpcEvents.GET_LOCAL_VERSION_STATE, (event, ver) => {
    const normalisedVer = '__uuid__devtron' in ver ? (ver as any).args[0] : ver;
    event.returnValue = getLocalVersionState(normalisedVer);
  });
  ipcMainManager.on(IpcEvents.GET_OLDEST_SUPPORTED_MAJOR, (event) => {
    event.returnValue = getOldestSupportedMajor();
  });
  ipcMainManager.on(IpcEvents.GET_RELEASED_VERSIONS, (event) => {
    event.returnValue = getReleasedVersions();
  });
  ipcMainManager.handle(
    IpcEvents.GET_RELEASE_INFO,
    (_: IpcMainInvokeEvent, version) => knownVersions.getReleaseInfo(version),
  );

  return knownVersions;
}
