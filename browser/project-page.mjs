// The project page (M2-i): opens a project folder and shows its state as `eps status` does. It only reads the
// folder; nothing is written and nothing is sent anywhere. Bundled into browser/eps-project.html by
// tools/gen-pages.mjs, so it works opened as a file, with no network and nothing installed.

import { folderAccess, explainFolderError } from './access.mjs';
import { saveFolder, loadFolder } from './handle-store.mjs';
import { projectState, verdict } from './view.mjs';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const KEY = 'project';
let current = null; // {handle, state}

function message(text, kind = '') {
  $('message').textContent = text;
  $('message').className = kind;
}

async function render(handle) {
  message(`Reading ${handle.name}…`);
  try {
    const state = await projectState(handle);
    current = { handle, state };
    $('folder').textContent = handle.name;
    $('verdict').textContent = verdict(state.exit);
    $('verdict').className = state.exit === 0 ? 'ok' : 'warn';
    $('status').textContent = state.text;
    $('sha').textContent = state.sha256;
    $('read-at').textContent = new Date().toLocaleString();
    show('result');
    show('refresh');
    show('save');
    message('');
  } catch (e) {
    message(`${handle.name} could not be read: ${explainFolderError(e).message}`, 'warn');
  }
}

async function open() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'eps-project', mode: 'read' });
  } catch (e) {
    const x = explainFolderError(e);
    message(x.message, x.kind === 'cancelled' ? '' : 'warn');
    return;
  }
  try {
    await saveFolder(KEY, handle);
    $('remembered').textContent = `This page will remember ${handle.name} when the browser restarts (stored ${new Date().toLocaleString()}).`;
  } catch (e) {
    $('remembered').textContent = `This page cannot remember the folder here (${e?.name ?? 'error'}: ${e?.message ?? e}); open it again after a restart.`;
  }
  show('reopen', false);
  await render(handle);
}

// M2-b: after a restart, what survived: the stored handle, and the permission the browser reports for it.
async function remembered() {
  let stored;
  try {
    stored = await loadFolder(KEY);
  } catch (e) {
    $('remembered').textContent = `Remembering a folder is not available on this page (${e?.name ?? 'error'}: ${e?.message ?? e}).`;
    return;
  }
  if (!stored?.handle) { $('remembered').textContent = 'No folder remembered yet.'; return; }
  const { handle, storedAt } = stored;
  let permission;
  try { permission = await handle.queryPermission({ mode: 'read' }); } catch (e) { permission = `unknown (${e?.name ?? e})`; }
  $('remembered').textContent = `Remembered folder: ${handle.name}, stored ${new Date(storedAt).toLocaleString()}. `
    + `Permission when this page loaded: ${permission}.`;
  if (permission === 'granted') { await render(handle); return; }
  $('reopen').textContent = `Reopen ${handle.name}`;
  show('reopen');
  $('reopen').onclick = async () => {
    try {
      const p = await handle.requestPermission({ mode: 'read' });
      if (p !== 'granted') { message(`The browser did not give access to ${handle.name} (${p}).`, 'warn'); return; }
      show('reopen', false);
      await render(handle);
    } catch (e) {
      message(explainFolderError(e).message, 'warn');
    }
  };
}

function save() {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.state.bytes], { type: 'application/ld+json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${current.handle.name}-report.jsonld` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('origin').textContent = location.protocol === 'file:' ? 'opened as a file' : location.origin;
const access = folderAccess(window);
if (!access.available) {
  $('access').textContent = access.message;
  show('access');
  $('open').disabled = true;
} else {
  $('open').onclick = open;
  $('refresh').onclick = () => current && render(current.handle);
  $('save').onclick = save;
  remembered();
}
