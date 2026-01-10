/**
 * Returns the correct name of ELectron for the current platform
 */
export function getElectronNameForPlatform(): string {
  switch (window.ElectronFiddle.platform) {
    case 'win32': {
      return 'electron.exe';
    }
    case 'darwin': {
      return 'Electron.app';
    }
    default: {
      return 'electron';
    }
  }
}

/**
 * Returns the correct name of React Native Desktop for the current platform
 */
export function getReactNativeDesktopNameForPlatform(): string {
  switch (window.ElectronFiddle.platform) {
    case 'win32': {
      return 'React Native Windows';
    }
    case 'darwin': {
      return 'React Native macOS';
    }
    default: {
      return 'React Native';
    }
  }
}
