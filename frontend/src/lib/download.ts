/**
 * Saves a file the browser built (an export). The object URL is revoked once
 * the download has started; revoked at once, some browsers drop it.
 */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
