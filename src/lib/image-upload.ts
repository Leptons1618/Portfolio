/**
 * Upload an image from an admin screen, and see it before anything references it.
 *
 * Every image field on this surface is a text input holding a site-relative
 * path — `/media/images/projects/thing.webp` — and until this existed the admin
 * had no way to put the bytes anywhere: you left, added the file by hand, came
 * back and retyped the path from memory. This attaches the missing half to
 * inputs that already exist. Pick or drop a file, it is stored, and the field
 * is filled in with the path that file now answers to.
 *
 * **It uploads on pick, not with the form's save.** An asset is not a field:
 * folding a binary write into the form's own save would be two writes
 * pretending to be one, with a rollback path for the case where the second
 * fails. The asymmetry decides it — an uploaded image nobody references is a
 * harmless orphan, while a saved path pointing at bytes that were never written
 * is a broken image on a live page.
 *
 * Bytes go to `POST /api/media`, which stores them in D1 and serves them back
 * from `/media/…` — so the path this writes into the field resolves on the very
 * next request, on this origin, including in `npm run dev`. Nothing here
 * touches the repository; that is what let the GitHub App drop to read-only.
 *
 * The control is built in the browser, so none of its nodes carries a page's
 * `data-astro-cid` and a page-scoped rule would never reach them. Its styles
 * live in `src/styles/admin.css`, which is global — the rule for anything a
 * shared module builds.
 */

import { slugify } from './content-store';
import { getToken } from './github';
import { MAX_MEDIA_BYTES, MEDIA_TYPES } from './media';
import { openMediaLibrary } from './media-library';
import { toast } from './admin';
import { insertImageLine, replaceText, uploadPlaceholder } from './md-edit';

export interface ImageUploadOptions {
  /** Storage directory, unslashed at both ends — `images/projects`. */
  dir: string;
  /**
   * The filename stem, read at upload time rather than passed as a string: on
   * the import form the name comes from a title that is still being typed.
   * Falling back to the picked file's own stem keeps it working when empty.
   */
  name: () => string;
}

/** `photo (1).PNG` → `photo-1`. Empty when there is nothing usable left. */
const stemOf = (filename: string) => slugify(filename.replace(/\.[^.]+$/, ''));

/** `WEBP · AVIF · …`, from the one list both sides of the wire agree on. */
const ACCEPTED = [...new Set(Object.values(MEDIA_TYPES))].map(e => e.toUpperCase()).join(', ');

/** `1.4 MB`. Rounded the way a file manager rounds it, not the way a byte does. */
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Attach upload + preview to an existing image path input.
 *
 * The input keeps being the source of truth — typing a path by hand still
 * works, and every form on this surface reads and writes `.value` exactly as
 * it did. Everything added here is a second way to fill it in and a way to see
 * what is in it.
 */
export function attachImageUpload(input: HTMLInputElement, options: ImageUploadOptions): void {
  const box = document.createElement('div');
  box.className = 'image-upload';

  /**
   * The frame is a button.
   *
   * It was a `<div>` that accepted a drop, which meant the largest, most
   * obviously clickable thing on the control did nothing when clicked, and the
   * only working affordance was the small secondary button underneath it. As a
   * button, click, Enter and Space all open the picker, it takes a focus ring
   * from the surface's own rules, and assistive technology is told it is
   * pressable rather than told nothing at all.
   */
  const frame = document.createElement('button');
  frame.type = 'button';
  frame.className = 'image-upload-frame';
  frame.dataset.state = 'empty';

  const preview = document.createElement('img');
  preview.className = 'image-upload-preview';
  preview.alt = '';
  preview.hidden = true;

  /* Three lines rather than one, because the old single line answered only the
     first of the three questions this control gets asked: how do I use it,
     what else can I do, and what will it take. */
  const empty = document.createElement('span');
  empty.className = 'image-upload-empty';

  const glyph = document.createElement('span');
  glyph.className = 'image-upload-glyph';
  glyph.textContent = '↑';

  const hint = document.createElement('span');
  hint.className = 'image-upload-hint';

  const sub = document.createElement('span');
  sub.className = 'image-upload-sub';

  const DROP_HINT = 'Drop an image, or click to choose';
  const DROP_SUB = `${ACCEPTED} — up to ${fileSize(MAX_MEDIA_BYTES)}`;

  empty.append(glyph, hint, sub);

  /* Over the frame, not beside it: what has to be unmistakable while bytes are
     in flight is *which* field is waiting, and a message under a form with two
     image pickers on it does not say that. */
  const veil = document.createElement('span');
  veil.className = 'image-upload-veil';
  veil.hidden = true;

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = Object.keys(MEDIA_TYPES).join(',');
  picker.hidden = true;

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'btn btn-secondary btn-sm';
  choose.textContent = 'Upload image';

  /* The other half of "put an image in this field": reusing one that is
     already here. Without it the only way to reference an existing image was to
     remember its path and retype it, which is exactly how a field comes to
     point at bytes that were written under a slightly different name. */
  const browse = document.createElement('button');
  browse.type = 'button';
  browse.className = 'btn btn-secondary btn-sm';
  browse.textContent = 'Browse library';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-ghost btn-sm';
  clear.textContent = 'Clear';

  const status = document.createElement('span');
  status.className = 'image-upload-status';

  const bar = document.createElement('div');
  bar.className = 'image-upload-bar';
  bar.append(choose, browse, clear, status);

  frame.append(preview, empty, veil);
  box.append(frame, bar, picker);
  input.after(box);

  const say = (text: string, tone: 'info' | 'error' | 'success' = 'info') => {
    status.dataset.tone = tone;
    status.textContent = text;
  };

  /* There is deliberately no object-URL cache here. An upload used to be a
     commit, so the bytes existed in the repository while this origin went on
     404ing them until the next deploy — and the preview had to show the local
     file to show anything at all. The upload lands in the database this origin
     reads now, so `/media/…` answers on the very next request and the field's
     own value is the honest thing to preview. */

  function show() {
    const value = input.value.trim();
    clear.hidden = !value;

    /* The field is free text and this puts it in an attribute, so the same
       scheme rule the journal preview applies to authored links applies here:
       a site-relative path or plain http(s), nothing else. `<img>` will not run
       a `javascript:` URL, but "will not" is a browser's promise about one sink,
       and the allowlist is ours about all of them.

       It says so in the frame rather than in the status line because this runs
       on every keystroke: halfway through typing `https://` the value is not yet
       a URL, and a red error that appears and disappears as someone types is
       noise about a problem they are already in the middle of fixing. */
    if (!value || (!value.startsWith('/') && !/^https?:\/\//i.test(value))) {
      preview.hidden = true;
      preview.removeAttribute('src');
      empty.hidden = false;
      frame.dataset.state = 'empty';
      const typing = Boolean(value);
      glyph.textContent = typing ? '!' : '↑';
      hint.textContent = typing ? 'That is not a path this site can resolve' : DROP_HINT;
      sub.textContent = typing ? 'A path starts with / — or paste an http(s) URL' : DROP_SUB;
      return;
    }

    empty.hidden = true;
    preview.hidden = false;
    frame.dataset.state = 'filled';
    preview.src = value;
  }

  /* One source, so one failure mode: whatever the field names does not load,
     and only the author can fix that. There is no second place to look now
     that an uploaded image is served by this origin immediately. */
  preview.addEventListener('error', () => {
    const value = input.value.trim();
    preview.hidden = true;
    empty.hidden = false;
    frame.dataset.state = 'empty';
    glyph.textContent = '!';
    hint.textContent = 'Nothing loads from that path';
    sub.textContent = DROP_HINT;
    say(`${value} did not load — check the path, or upload the image here.`, 'error');
  });

  /**
   * `fillProject()`, the import form's prefill and every Revert button assign
   * `input.value` directly, and assigning a property fires no event — so the
   * preview would keep showing the last thing loaded while the field said
   * something else entirely, which is worse than showing nothing.
   *
   * Overriding the accessor on this one element is the only hook the platform
   * offers for that, and it is the fix that cannot be forgotten: the
   * alternative is an `input` event dispatched by hand at each of the six
   * places a value is assigned, five of which are in files this one does not
   * own. Whoever wrapped the element first still does the work — chained
   * below rather than assumed to be the prototype's, so `trackDirty()` in
   * `admin.ts` survives whichever of the two ran first.
   */
  const descriptor =
    Object.getOwnPropertyDescriptor(input, 'value') ??
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return descriptor.get!.call(input);
    },
    set(next: string) {
      descriptor.set!.call(input, next);
      show();
      /* An `input` event, because this write is an edit and everything
         downstream decides what to do with an edit by listening for one:
         `trackDirty()` enables the Save button, the journal editor's
         `holdLocally()` arms its snapshot, and a project screen's leave guard
         arms its confirm. Assigning `.value` fires nothing, so an upload, a
         library pick and a Clear all left the form looking clean — Save stayed
         disabled, the status line said there was nothing to save, and the image
         was silently not on the row. Dispatching here fixes every field at
         once, because every one of them is this setter. */
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });

  input.addEventListener('input', show);

  clear.addEventListener('click', () => {
    input.value = '';
    say('Cleared here. The field is saved with the form.');
  });

  const openPicker = () => picker.click();
  choose.addEventListener('click', openPicker);
  frame.addEventListener('click', openPicker);

  /* The library's own "Upload new" comes back here rather than opening a second
     picker of its own: this control already owns the picker, the directory and
     the naming rule, and the modal is shared by every field on the page. */
  browse.addEventListener('click', () => {
    void openMediaLibrary({ current: input.value.trim(), onUpload: openPicker }).then(url => {
      if (!url) return;
      input.value = url;
      say('Picked from the library. Save the form to reference it.', 'success');
    });
  });

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    /* Reset first: picking the same file twice in a row fires no `change` at
       all unless the input has forgotten it. */
    picker.value = '';
    if (file) void upload(file);
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    frame.addEventListener(type, event => {
      event.preventDefault();
      frame.dataset.over = 'true';
    });
  }
  for (const type of ['dragleave', 'dragend'] as const) {
    frame.addEventListener(type, () => delete frame.dataset.over);
  }
  frame.addEventListener('drop', event => {
    event.preventDefault();
    delete frame.dataset.over;
    const file = event.dataTransfer?.files?.[0];
    if (file) void upload(file);
  });
  /* A screenshot pasted while the frame has focus — the frame is a button, so
     it can hold focus, and a paste is the quickest way a screenshot arrives. */
  frame.addEventListener('paste', event => {
    const [file] = imageFiles(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void upload(file);
  });

  /** The frame's busy state — a spinner over whatever it is currently showing. */
  function setUploading(on: boolean, label = 'Uploading…') {
    frame.disabled = on;
    choose.disabled = on;
    veil.hidden = !on;
    if (!on) return;
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    veil.replaceChildren(spinner, document.createTextNode(label));
  }

  async function upload(file: File): Promise<void> {
    const problem = refusal(file);
    if (problem) {
      say(problem, 'error');
      toast(problem, { tone: 'error' });
      return;
    }

    const stem = slugify(options.name()) || stemOf(file.name) || 'image';

    setUploading(true);
    say(`Uploading ${file.name} — ${fileSize(file.size)}…`);
    const pending = toast(`Uploading ${file.name}…`, { tone: 'pending' });

    try {
      const url = await putMedia(file, options.dir, stem);
      input.value = url;
      say(`Uploaded — ${fileSize(file.size)}. Save the form to reference it.`, 'success');
      pending.update('Image uploaded. Save the form to reference it.', {
        tone: 'success',
        action: { label: 'open the file ↗', href: url },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The upload failed.';
      say(message, 'error');
      pending.update(message, { tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  show();
}

/** Why this file cannot be uploaded from here, or `null` when it can. */
function refusal(file: File): string | null {
  if (!MEDIA_TYPES[file.type]) {
    return `${file.type || 'That file'} is not an image this site can serve. Use ${ACCEPTED}.`;
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return (
      `${fileSize(file.size)} is too large for a page image — resize it under ` +
      `${fileSize(MAX_MEDIA_BYTES)} first. WebP at about 1600px wide is what the rest of the site uses.`
    );
  }
  if (!getToken()) return 'Uploading writes to the site, so it needs a session. Sign in from the rail.';
  return null;
}

/**
 * Store the bytes and answer with the `/media/…` URL they are served from.
 * One request for every way an image arrives on this surface — an image
 * field's picker, a drop, a paste into a write-up — so they cannot disagree
 * about the endpoint, the headers or what a refusal says.
 */
export async function putMedia(file: File, dir: string, name: string): Promise<string> {
  /* The bytes go up as the request body rather than base64 inside JSON: the
     endpoint stores them as a BLOB, so there is no envelope inflating them by
     a third on the way. */
  const query = new URLSearchParams({ dir, name });
  const response = await fetch(`/api/media?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken() ?? ''}`, 'Content-Type': file.type },
    body: await file.arrayBuffer(),
  });
  const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !result.url) throw new Error(result.error ?? `The upload failed (${response.status}).`);
  return result.url;
}

/**
 * The image files a paste or a drop carries — or none, when it is a text
 * paste that happens to carry an image too.
 *
 * Rich text copied from a document or a web page arrives as `text/plain` *and*
 * `text/html`, sometimes with an image alongside; that is a paste of words and
 * stays one. Everything else that carries an image file is an image: a
 * screenshot (no text at all), "Copy image" in a browser (HTML, no plain text),
 * a file copied in Finder (its name as plain text, no HTML).
 */
function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files].filter(file => file.type.startsWith('image/'));
  const richText = data.types.includes('text/plain') && data.types.includes('text/html');
  return richText ? [] : files;
}

/**
 * Paste or drop images into a markdown body — the journal's, a case study's.
 *
 * Each image gets a placeholder line at the caret at once, uploads, and is
 * swapped for `![name](/media/…)` when the bytes are stored; a failure removes
 * the placeholder and says why. Edits go through `setRangeText`, so the
 * textarea's own undo keeps working, and an `input` event follows each one
 * because a range edit fires none and the editors' dirty tracking, autosave
 * and preview all listen for it. The text transforms are the pure ones in
 * `md-edit.ts`, which `check:editor` tests.
 *
 * Every image gets its own name — `<name>-<id>` — because `/api/media`
 * replaces by path, and three screenshots pasted into one post must not be
 * one file overwritten twice.
 */
export function attachMarkdownImages(area: HTMLTextAreaElement, options: ImageUploadOptions): void {
  let sequence = 0;

  const changed = () => area.dispatchEvent(new Event('input', { bubbles: true }));

  /**
   * Swap a placeholder without moving the author. Not `setRangeText(…,
   * 'preserve')`: under it a caret sitting at the placeholder's end — exactly
   * where a paste leaves it — becomes a selection of the whole new line, and
   * the next keystroke deletes the image. The selection is carried across by
   * hand instead: shifted when it is after the swap, parked after the new text
   * when it was inside it.
   */
  const swap = (fix: { from: number; to: number; insert: string }) => {
    const { selectionStart, selectionEnd } = area;
    const shift = fix.insert.length - (fix.to - fix.from);
    const carry = (at: number) => (at >= fix.to ? at + shift : at > fix.from ? fix.from + fix.insert.length : at);
    area.setRangeText(fix.insert, fix.from, fix.to);
    area.setSelectionRange(carry(selectionStart), carry(selectionEnd));
    changed();
  };

  const place = (file: File) => {
    const problem = refusal(file);
    if (problem) {
      toast(problem, { tone: 'error' });
      return;
    }
    const id = `${Date.now().toString(36)}${(sequence++).toString(36)}`;
    const stem = stemOf(file.name) || 'image';
    const placeholder = uploadPlaceholder(stem, id);
    const edit = insertImageLine(area.value, { start: area.selectionStart, end: area.selectionEnd }, `Uploading ${stem}…`, `#${id}`);
    area.setRangeText(edit.insert, edit.from, edit.to, 'end');
    area.setSelectionRange(edit.selStart, edit.selEnd);
    changed();

    const name = `${slugify(options.name()) || 'image'}-${id}`;
    void putMedia(file, options.dir, name).then(
      url => {
        const fix = replaceText(area.value, placeholder, `![${stem}](${url})`);
        if (!fix) return;
        swap(fix);
        toast(`${file.name} uploaded. Save to keep it in the post.`, { tone: 'success' });
      },
      (error: unknown) => {
        const fix = replaceText(area.value, placeholder, '');
        if (fix) swap(fix);
        toast(error instanceof Error ? error.message : 'The upload failed.', { tone: 'error' });
      },
    );
  };

  area.addEventListener('paste', event => {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    files.forEach(place);
  });
  area.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  area.addEventListener('drop', event => {
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    area.focus();
    files.forEach(place);
  });
}
