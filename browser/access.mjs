// Whether this page can open folders, and plain words for when it cannot (M2-c). A tool such as SDD shows the same
// words and falls back to opening and saving single files.

export const FALLBACK = 'A tool such as SDD can still open and save single files instead of a project folder.';

/** {available: true} or {available: false, reason, message}. `win` is the page's window (a stand-in in tests). */
export function folderAccess(win = globalThis) {
  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      available: false,
      reason: 'missing',
      message: `This browser cannot open folders: it does not have the File System Access API (Chrome and Edge on a computer have it). ${FALLBACK}`,
    };
  }
  if (win.isSecureContext === false) {
    return {
      available: false,
      reason: 'insecure',
      message: `Folders can be opened only from a page opened as a file or from this computer (http://localhost), not from this address. ${FALLBACK}`,
    };
  }
  return { available: true };
}

/** {kind: 'cancelled' | 'blocked' | 'error', message} for an error from showDirectoryPicker() or requestPermission(). */
export function explainFolderError(e) {
  const name = e?.name;
  if (name === 'AbortError') return { kind: 'cancelled', message: 'No folder was chosen.' };
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return {
      kind: 'blocked',
      message: `This browser is not allowed to open folders here: its settings, or your organization's policy, block folder access (${name}). ${FALLBACK}`,
    };
  }
  return { kind: 'error', message: `The folder could not be opened (${name ?? 'error'}: ${e?.message ?? e}).` };
}
