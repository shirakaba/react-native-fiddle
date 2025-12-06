/**
 * disables download button for versions:
 * - on all non-ARM Macs.
 * - on all Windows PCs.
 * (because we only release rnmprebuilds for darwin-arm64 at present)
 * Reference: {@link https://github.com/shirakaba/rnmprebuilds/releases}
 *
 * @param _version - electron version
 */
export function disableDownload(_version: string): boolean {
  return (
    window.ElectronFiddle.platform !== 'darwin' ||
    window.ElectronFiddle.arch !== 'arm64'
  );
}
