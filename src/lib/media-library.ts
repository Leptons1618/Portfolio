/**
 * Pick an image that has already been uploaded.
 *
 * Every image field on this surface was a text input holding a path, with an
 * upload control bolted beside it. That covers putting a *new* image somewhere;
 * it has never covered the other half, which is reusing one. The only way to
 * reference an existing image was to remember its path and retype it — and a
 * path retyped from memory is how a field ends up pointing at bytes that were
 * written under a slightly different name, which renders as a broken image on a
 * live page with nothing on the editing screen saying so.
 *
 * This is the missing half: a grid of what is actually in the `media` table,
 * read from `GET /api/media`, with the thumbnails served by the same
 * `/media/…` URLs the field will hold. If a tile renders, the path works —
 * there is no way to pick something that does not exist.
 *
 * ## Shape
 *
 * One `<dialog>` per document, built lazily and shared by every upload control
 * on the page — five of them on a project's page. `open()` returns a promise
 * that resolves with the chosen URL, or `null` if the dialog was dismissed, so
 * a caller is one `await` rather than a pile of callbacks.
 *
 * Selection is two steps on purpose. Clicking a tile highlights it; the foot's
 * primary button is what commits. A single click that both chose and closed
 * would make overwriting the current image the easiest thing to do by accident
 * in a grid whose tiles are all the same size.
 *
 * Everything here is built with `createElement`, so none of it carries a page's
 * `data-astro-cid` — the styles live in `src/styles/admin.css`, which is
 * global, the same door the upload control and the import rows go through.
 * Paths come back from the database and never go near an HTML parser.
 */

import { getToken } from './github';

export interface MediaItem {
  path: string;
  url: string;
  mime: string;
  size: number;
  updatedAt: string;
}

export interface MediaLibraryOptions {
  /** Highlighted on open, so the dialog says what the field currently holds. */
  current?: string;
  /** Runs when the foot's "Upload new" is pressed. The dialog closes first. */
  onUpload?: () => void;
}

/** `1.4 MB` — a file manager's rounding, not a byte's. */
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** `images/journal/a-post-hero.jpg` → `a-post-hero.jpg`. */
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** `images/journal/a-post-hero.jpg` → `images/journal`. */
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

interface Library {
  dialog: HTMLDialogElement;
  list: HTMLElement;
  search: HTMLInputElement;
  status: HTMLElement;
  use: HTMLButtonElement;
  upload: HTMLButtonElement;
}

let library: Library | null = null;

/* State for the open dialog. Module-scoped rather than closed over, because the
   dialog is shared: whichever control opened it last owns these. */
let selected: string | null = null;
let items: MediaItem[] = [];
let resolveOpen: ((url: string | null) => void) | null = null;
let onUploadRequest: (() => void) | null = null;

/**
 * Loading tiles, at the size real ones will be.
 *
 * The dialog's height is fixed by `.modal-fixed` so its frame does not move;
 * these are what stop the *inside* from jumping when the response lands. Same
 * pairing as the import dialog's skeleton rows.
 */
function renderSkeleton(list: HTMLElement) {
  list.replaceChildren(
    ...Array.from({ length: 8 }, () => {
      const tile = document.createElement('div');
      tile.className = 'media-tile media-tile-skeleton';
      tile.setAttribute('aria-hidden', 'true');

      const frame = document.createElement('div');
      frame.className = 'skeleton media-tile-frame';
      const line = document.createElement('div');
      line.className = 'skeleton skeleton-line-sm media-tile-skeleton-line';

      tile.append(frame, line);
      return tile;
    }),
  );
}

function renderEmpty(list: HTMLElement, message: string) {
  const empty = document.createElement('div');
  empty.className = 'admin-empty media-empty';

  const title = document.createElement('p');
  title.className = 'admin-empty-copy';
  title.textContent = message;

  empty.appendChild(title);
  list.replaceChildren(empty);
}

function renderList() {
  if (!library) return;
  const term = library.search.value.trim().toLowerCase();
  const visible = term ? items.filter(item => item.path.toLowerCase().includes(term)) : items;

  if (!visible.length) {
    renderEmpty(
      library.list,
      items.length
        ? 'No uploaded image matches that search.'
        : 'Nothing has been uploaded yet. Upload one and it will be here for every other field to reuse.',
    );
    library.use.disabled = true;
    return;
  }

  library.list.replaceChildren(...visible.map(tile));
  library.use.disabled = selected === null;
}

/**
 * One image, as a button.
 *
 * The thumbnail is the real `/media/…` URL rather than anything generated, so
 * the grid is also a live check: a tile that fails to render is an image the
 * field would fail to render too, and it says so in place instead of letting
 * the path be picked.
 */
function tile(item: MediaItem): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'media-tile';
  button.dataset.url = item.url;
  if (item.url === selected) button.dataset.selected = 'true';
  button.setAttribute('aria-pressed', String(item.url === selected));

  const frame = document.createElement('span');
  frame.className = 'media-tile-frame';

  const image = document.createElement('img');
  image.className = 'media-tile-img';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt = '';
  image.src = item.url;

  const broken = document.createElement('span');
  broken.className = 'media-tile-broken';
  broken.textContent = 'will not load';
  broken.hidden = true;

  image.addEventListener('error', () => {
    image.hidden = true;
    broken.hidden = false;
    button.dataset.broken = 'true';
  });

  frame.append(image, broken);

  const name = document.createElement('span');
  name.className = 'media-tile-name';
  name.textContent = basename(item.path);
  name.title = item.path;

  const meta = document.createElement('span');
  meta.className = 'media-tile-meta';
  meta.textContent = `${dirname(item.path)} · ${fileSize(item.size)}`;

  button.append(frame, name, meta);

  button.addEventListener('click', () => {
    selected = item.url;
    library?.list.querySelectorAll<HTMLElement>('.media-tile').forEach(other => {
      const on = other.dataset.url === selected;
      if (on) other.dataset.selected = 'true';
      else delete other.dataset.selected;
      other.setAttribute('aria-pressed', String(on));
    });
    if (library) {
      library.use.disabled = false;
      library.status.textContent = item.path;
    }
  });

  return button;
}

async function load() {
  if (!library) return;
  library.status.textContent = 'Reading the library…';
  renderSkeleton(library.list);
  library.use.disabled = true;

  const token = getToken();
  if (!token) {
    library.status.textContent = 'Sign in to browse what has been uploaded.';
    renderEmpty(library.list, 'The library needs a session — sign in from the rail.');
    return;
  }

  try {
    const response = await fetch('/api/media', { headers: { Authorization: `Bearer ${token}` } });
    const payload = (await response.json().catch(() => ({}))) as {
      items?: MediaItem[];
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? `The library could not be read (${response.status}).`);

    items = payload.items ?? [];
    const total = items.reduce((sum, item) => sum + item.size, 0);
    library.status.textContent = items.length
      ? `${items.length} image${items.length === 1 ? '' : 's'} · ${fileSize(total)}`
      : 'Nothing uploaded yet.';
    renderList();
  } catch (error) {
    library.status.textContent = error instanceof Error ? error.message : 'The library could not be read.';
    renderEmpty(library.list, 'The library could not be read. Close this and try again.');
  }
}

/**
 * Build the dialog, once.
 *
 * Rebuilt when it is no longer connected: `AdminLayout` mounts `<ClientRouter />`
 * and a navigation replaces the body, so a node appended to `document.body`
 * does not survive one. Checking `isConnected` is cheaper and more honest than
 * trying to persist it — there is no state in here worth carrying across a
 * screen change.
 */
function build(): Library {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal-fixed media-modal';
  dialog.setAttribute('aria-label', 'Media library');

  // — head —
  const head = document.createElement('div');
  head.className = 'modal-head';

  const headCopy = document.createElement('div');
  headCopy.className = 'modal-head-copy';

  const eyebrow = document.createElement('h6');
  eyebrow.className = 'admin-eyebrow-mono';
  eyebrow.textContent = 'MODULE: MEDIA';

  const title = document.createElement('h2');
  title.className = 'modal-title';
  title.textContent = 'Media library';

  const status = document.createElement('p');
  status.className = 'text-muted admin-note modal-lede';

  headCopy.append(eyebrow, title, status);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn-icon';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => finish(null));

  head.append(headCopy, closeButton);

  // — body —
  const body = document.createElement('div');
  body.className = 'modal-body';

  const controls = document.createElement('div');
  controls.className = 'modal-controls';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input modal-search';
  search.placeholder = 'Search paths…';
  search.setAttribute('aria-label', 'Search uploaded images');
  search.addEventListener('input', renderList);

  controls.appendChild(search);

  const list = document.createElement('div');
  list.className = 'media-grid';

  body.append(controls, list);

  // — foot —
  const foot = document.createElement('div');
  foot.className = 'modal-foot';

  const note = document.createElement('p');
  note.className = 'text-muted modal-foot-note';
  note.textContent =
    'Every image here is already served by this site. Uploading under a path that exists replaces it, ' +
    'and every field pointing at that path shows the new image.';

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'btn btn-secondary';
  upload.textContent = 'Upload new';
  upload.addEventListener('click', () => {
    const request = onUploadRequest;
    finish(null);
    request?.();
  });

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'btn btn-primary';
  use.textContent = 'Use this image';
  use.disabled = true;
  use.addEventListener('click', () => finish(selected));

  actions.append(upload, use);
  foot.append(note, actions);

  dialog.append(head, body, foot);

  /* A `<dialog>` closes on Escape by itself, and that path does not go through
     `finish()` — so the promise is settled from `close` rather than from each
     button, and every dismissal resolves exactly once. */
  dialog.addEventListener('close', () => {
    resolveOpen?.(null);
    resolveOpen = null;
  });

  // Backdrop click is not part of the element; it is the one thing to wire up.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) finish(null);
  });

  document.body.appendChild(dialog);
  return { dialog, list, search, status, use, upload };
}

/** Settle the promise *then* close, so `close` finds nothing left to resolve. */
function finish(url: string | null) {
  const resolve = resolveOpen;
  resolveOpen = null;
  resolve?.(url);
  library?.dialog.close();
}

/**
 * Open the library and wait for a choice.
 *
 * Resolves with a `/media/…` URL, or `null` if it was dismissed — Escape, the
 * backdrop, the close button and "Upload new" all take the second path.
 */
export function openMediaLibrary(options: MediaLibraryOptions = {}): Promise<string | null> {
  if (!library || !library.dialog.isConnected) library = build();

  /* A second `open()` while one is pending would strand the first promise
     forever. Settle it before taking the dialog over. */
  resolveOpen?.(null);

  selected = options.current?.trim() || null;
  onUploadRequest = options.onUpload ?? null;
  library.search.value = '';
  library.use.disabled = true;

  const promise = new Promise<string | null>(resolve => {
    resolveOpen = resolve;
  });

  library.dialog.showModal();
  void load();

  return promise;
}
