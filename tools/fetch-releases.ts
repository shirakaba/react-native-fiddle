import * as fs from 'node:fs';
import * as path from 'node:path';

// import { ElectronVersions } from '@electron/fiddle-core';
import type { ReleaseInfo } from '@electron/fiddle-core';

const file = path.join(__dirname, '..', 'static', 'releases.json');

export async function populateReleases() {
  // const elves = await ElectronVersions.create({ ignoreCache: true });
  // const releases = elves.versions.map(({ version }) =>
  //   elves.getReleaseInfo(version),
  // );

  let rnmPrebuildReleases: Array<{
    tag_name: string;
    published_at: Date;
  }>;
  try {
    rnmPrebuildReleases = await getRnmPrebuildReleases();
  } catch (error) {
    // - 403 likely indicates a rate limit error.
    // - 504 is a server timeout.
    // I'm adding this fallback to allow me to keep on developing despite GitHub
    // becoming inaccessible.
    if (
      error instanceof Error &&
      (error.message === 'GitHub API error: 403' ||
        error.message === 'GitHub API error: 504')
    ) {
      // https://github.com/shirakaba/rnmprebuilds/releases
      // https://api.github.com/repos/shirakaba/rnmprebuilds/releases
      rnmPrebuildReleases = [
        { tag_name: 'v0.79.1', published_at: new Date('2026-01-11T14:01:13Z') },
      ];

      console.error(
        `Got "${error.message}" response when calling getRnmPrebuildReleases(). Falling back to hard-coded ${rnmPrebuildReleases.at(-1)!.tag_name} release.`,
      );
    } else {
      throw error;
    }
  }

  // Keep this mapping logic in sync with src/main/versions.ts.
  const releases: Array<ReleaseInfo> = rnmPrebuildReleases
    .filter(({ tag_name }) => tag_name.startsWith('v'))
    .map(({ tag_name, published_at }) => {
      const date = new Date(published_at);

      return {
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
      };
    });

  if (releases.length) {
    console.log(
      `Updating local releases.json with ${releases.length} versions.`,
    );

    await fs.promises.writeFile(file, JSON.stringify(releases));
  } else if (process.env.CI) {
    throw new Error('Failed to fetch latest releases.json');
  } else {
    console.warn(
      'Failed to fetch latest releases.json, falling back to whatever exists on disk',
    );
  }
}

if (require.main === module) {
  (async () => {
    await populateReleases();
  })();
}

// Keep in sync with src/main/versions.ts
export async function getRnmPrebuildReleases() {
  const res = await fetch(
    'https://api.github.com/repos/shirakaba/rnmprebuilds/releases',
    {
      headers: { 'User-Agent': 'node' },
    },
  );

  // If this ever gives a 403, it's likely because we hit a rate limit.
  // Authenticated requests get a higher rate limit:
  // https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const releases = await res.json();

  return (releases as Array<{ tag_name: string; published_at: string }>).map(
    ({ tag_name, published_at }) => ({
      tag_name,
      published_at: new Date(published_at),
    }),
  );
}
