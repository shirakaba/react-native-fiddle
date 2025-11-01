const sources = {
  DEFAULT: {
    // href: 'https://github.com/electron/electron/releases/download/v999.0.0/electron-v999.0.0-darwin-arm64.zip',
    electronMirror:
      'https://github.com/shirakaba/rnmprebuilds/releases/download/',
    electronNightlyMirror:
      'https://github.com/shirakaba/rnmprebuilds/releases/download/',
  },
  CHINA: {
    electronMirror: 'https://npmmirror.com/mirrors/electron/',
    electronNightlyMirror: 'https://npmmirror.com/mirrors/electron-nightly/',
  },
  CUSTOM: {
    electronMirror: '',
    electronNightlyMirror: '',
  },
};

export const ELECTRON_MIRROR = {
  sourceType: 'DEFAULT' as keyof typeof sources,
  sources,
};

export type Sources = keyof typeof sources;
export type Mirrors = {
  electronMirror: string;
  electronNightlyMirror: string;
};
