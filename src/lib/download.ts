/**
 * How long a download's blob URL stays valid after the click. Chrome reads the blob during the
 * click, but WebKit (Safari, and every browser on iOS) starts the download later, after asking
 * the user, so revoking straight away makes the download fail silently
 * (`WebKitBlobResource error 1`). FileSaver.js waits 40 s for the same reason.
 */
export const REVOKE_DELAY_MS = 60_000

/** Download bytes as a file in the browser. */
export function download(bytes: Uint8Array | Blob, fileName: string): void {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
