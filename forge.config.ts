import * as path from 'node:path';

import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';

import { sourceEnvVars } from './env';
import packageJson from './package.json';
import { maybeFetchContributors } from './tools/contributors';
import { populateReleases } from './tools/fetch-releases';
import { mainConfig } from './tools/webpack/webpack.main.config';
import { rendererConfig } from './tools/webpack/webpack.renderer.config';

const { version } = packageJson;
const iconDir = path.resolve(__dirname, 'assets', 'icons');
const root = process.cwd();

const commonLinuxConfig = {
  categories: ['Development', 'Utility'],
  icon: {
    '1024x1024': path.resolve(iconDir, 'fiddle.png'),
    scalable: path.resolve(iconDir, 'fiddle.svg'),
  },
  mimeType: ['x-scheme-handler/react-native-fiddle'],
};

const requirements = path.resolve(__dirname, 'tools/certs/requirements.txt');

const config: ForgeConfig = {
  hooks: {
    generateAssets: async () => {
      await Promise.all([populateReleases(), maybeFetchContributors(true)]);
    },
  },
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        devContentSecurityPolicy:
          "default-src 'none'; img-src 'self' https: data:; media-src 'none'; child-src 'self'; object-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; font-src 'self' https:;",
        devServer: {
          // Disallow browser from opening/reloading with HMR in development mode.
          open: false,
          liveReload: false,
          hot: 'only',
        },
        mainConfig: mainConfig,
        renderer: {
          config: rendererConfig,
          entryPoints: [
            {
              html: path.join(root, './static/index.html'),
              js: path.join(root, './src/renderer/main.tsx'),
              name: 'main_window',
              preload: {
                js: path.join(root, 'src/preload/preload.ts'),
              },
            },
          ],
        },
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  packagerConfig: {
    name: 'React Native Fiddle',
    executableName: 'react-native-fiddle',
    asar: true,
    icon: path.resolve(__dirname, 'assets', 'icons', 'fiddle'),
    appBundleId: 'uk.co.birchlabs.reactnativefiddle',
    usageDescription: {
      Camera:
        'Access is needed by certain built-in fiddles in addition to any custom fiddles that use the Camera',
      Microphone:
        'Access is needed by certain built-in fiddles in addition to any custom fiddles that use the Microphone',
      Calendars:
        'Access is needed by certain built-in fiddles in addition to any custom fiddles that may access Calendars',
      Contacts:
        'Access is needed by certain built-in fiddles in addition to any custom fiddles that may access Contacts',
      Reminders:
        'Access is needed by certain built-in fiddles in addition to any custom fiddles that may access Reminders',
    },
    appCategoryType: 'public.app-category.developer-tools',
    protocols: [
      {
        name: 'React Native Fiddle Launch Protocol',
        schemes: ['react-native-fiddle'],
      },
    ],
    win32metadata: {
      CompanyName: 'Electron Community',
      OriginalFilename: 'React Native Fiddle',
    },
    osxSign: {
      identity: 'Developer ID Application: JAMES JOSHUA BIRCH (JM4MB83A5L)',
      optionsForFile: (filePath) =>
        ['(Plugin).app', '(GPU).app', '(Renderer).app'].some((helper) =>
          filePath.includes(helper),
        )
          ? { requirements }
          : {
              entitlements: 'static/entitlements.plist',
              requirements,
            },
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: (arch: string) => ({
        name: 'react-native-fiddle',
        authors: 'Electron Community',
        exe: 'react-native-fiddle.exe',
        iconUrl:
          'https://raw.githubusercontent.com/electron/fiddle/0119f0ce697f5ff7dec4fe51f17620c78cfd488b/assets/icons/fiddle.ico',
        loadingGif: './assets/loading.gif',
        noMsi: true,
        setupExe: `react-native-fiddle-${version}-win32-${arch}-setup.exe`,
        setupIcon: path.resolve(iconDir, 'fiddle.ico'),
        signWithParams: process.env.CERT_FINGERPRINT
          ? `/sha1 ${process.env.CERT_FINGERPRINT} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256`
          : undefined,
      }),
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: commonLinuxConfig,
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: commonLinuxConfig,
    },
    {
      name: '@reforged/maker-appimage',
      platforms: ['linux'],
      config: {
        options: commonLinuxConfig,
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'electron',
          name: 'fiddle',
        },
        draft: true,
        prerelease: false,
        generateReleaseNotes: true,
      },
    },
  ],
};

function notarizeMaybe() {
  // JB: Adding so that I can notarise locally using env vars in .env.
  sourceEnvVars();

  if (process.platform !== 'darwin') {
    return;
  }

  if (!process.env.CI && !process.env.FORCE_NOTARIZATION) {
    // Not in CI, skipping notarization
    console.log('Not in CI, skipping notarization');
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.warn(
      'Should be notarizing, but environment variables APPLE_ID or APPLE_ID_PASSWORD are missing!',
    );
    return;
  }

  config.packagerConfig!.osxNotarize = {
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: 'JM4MB83A5L',
  };
}

notarizeMaybe();

// Finally, export it
export default config;
