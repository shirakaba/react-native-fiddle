/**
 * disables download button for versions:
 * - on all non-ARM Macs.
 * - on all Windows PCs.
 * Reference: {@link https://github.com/shirakaba/rnmprebuilds/releases}
 *
 * @param _version - electron version
 */
export function disableDownload(_version: string): boolean {
  return (
    (window.ElectronFiddle.platform === 'darwin' &&
      window.ElectronFiddle.arch !== 'arm64') ||
    window.ElectronFiddle.platform === 'win32'
  );
}
