/**
 * Upload an image from an admin screen, and see it before anything references it.
 *
 * Every image field on this surface is a text input holding a site-relative
 * path — `/images/projects/thing.webp` — and the build only resolves that path
 * if the file is already in `public/`. Until now the admin had no way to put it
 * there: you left, committed the file by hand, came back and retyped the path
 * from memory, with `check-content.mjs` as the only thing standing between a
 * typo and a broken image. This attaches the missing half to inputs that
 * already exist. Pick or drop a file, it is committed under `public/<dir>/`,
 * and the field is filled in with the path that file now answers to.
 *
 * **It commits on pick, not on the form's Commit.** An asset is not frontmatter:
 * the form's own save patches one content file under the SHA it read, and
 * folding a binary write into that would be two commits pretending to be one,
 * with a rollback path for the case where the second fails. The asymmetry
 * decides it — an uploaded image nobody references is a harmless orphan in
 * `public/`, while a frontmatter path pointing at a file that was never written
 * fails `npm run check` and then the build.
 *
 * It no longer commits. Bytes go to `POST /api/media`, which stores them in
 * D1 and serves them back from `/media/…` — so the path this writes into the
 * field resolves the instant it is written, on this origin, including in
 * `npm run dev`. That removed the last thing on this site that wrote to the
 * repository, which is what let the GitHub App drop to read-only.
 */

import { slugify } from './content-store';
import { getToken } from './github';
import { MAX_MEDIA_BYTES, MEDIA_TYPES } from './media';

export interface ImageUploadOptions {
  /** Directory under `public/`, unslashed at both ends — `images/projects`. */
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

  const frame = document.createElement('div');
  frame.className = 'image-upload-frame';

  const preview = document.createElement('img');
  preview.alt = '';
  preview.hidden = true;

  const DROP_HINT = 'Drop an image here, or upload one';

  const hint = document.createElement('span');
  hint.className = 'image-upload-hint';
  hint.textContent = DROP_HINT;

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = Object.keys(MEDIA_TYPES).join(',');
  picker.hidden = true;

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'btn btn-secondary btn-sm';
  choose.textContent = 'Upload image';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-ghost btn-sm';
  clear.textContent = 'Clear';

  const status = document.createElement('span');
  status.className = 'image-upload-status';

  const bar = document.createElement('div');
  bar.className = 'image-upload-bar';
  bar.append(choose, clear, status);

  frame.append(preview, hint);
  box.append(frame, bar, picker);
  input.after(box);

  const say = (text: string, tone: 'info' | 'error' = 'info') => {
    status.dataset.tone = tone;
    status.textContent = text;
  };

  /* There is deliberately no object-URL cache here any more. An upload used to
     be a commit, so the bytes existed in the repository while this origin went
     on 404ing them until the next deploy — and the preview had to show the
     local file to show anything at all. The upload now lands in the database
     this origin reads, so `/media/…` answers on the very next request and the
     field's own value is the honest thing to preview. */

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
      hint.hidden = false;
      hint.textContent = value
        ? 'A path starts with / and resolves under public/ — or paste an http(s) URL'
        : DROP_HINT;
      return;
    }

    hint.hidden = true;
    preview.hidden = false;

    preview.src = value;
  }

  /* One source, so one failure mode: whatever the field names does not load,
     and only the author can fix that. There is no second place to look now
     that an uploaded image is served by this origin immediately. */
  preview.addEventListener('error', () => {
    const value = input.value.trim();
    preview.hidden = true;
    hint.hidden = false;
    hint.textContent = DROP_HINT;
    say(`Nothing loads from ${value} — check the path, or upload the image here.`, 'error');
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
   * own. The prototype's own descriptor still does the work.
   */
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return descriptor.get!.call(input);
    },
    set(next: string) {
      descriptor.set!.call(input, next);
      show();
    },
  });

  input.addEventListener('input', show);

  clear.addEventListener('click', () => {
    input.value = '';
    say('Cleared here. The field is saved with the form.');
  });

  choose.addEventListener('click', () => picker.click());
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

  async function upload(file: File): Promise<void> {
    const extension = MEDIA_TYPES[file.type];
    if (!extension) {
      return say(
        `${file.type || 'That file'} is not an image this site can serve. Use PNG, JPEG, WebP, AVIF, GIF or SVG.`,
        'error'
      );
    }
    if (file.size > MAX_MEDIA_BYTES) {
      return say(
        `${(file.size / 1024 / 1024).toFixed(1)} MB is too large for a page image — resize it under ` +
          `${MAX_MEDIA_BYTES / 1024 / 1024} MB first. WebP at about 1600px wide is what the rest of the site uses.`,
        'error'
      );
    }
    const token = getToken();
    if (!token) {
      return say('Uploading writes to the site, so it needs a session. Sign in from the rail.', 'error');
    }

    const stem = slugify(options.name()) || stemOf(file.name) || 'image';

    choose.disabled = true;
    say('Uploading…');
    try {
      /* The bytes go up as the request body rather than base64 inside JSON: the
         endpoint stores them as a BLOB, so there is no envelope inflating them
         by a third on the way. */
      const query = new URLSearchParams({ dir: options.dir, name: stem });
      const response = await fetch(`/api/media?${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
        body: await file.arrayBuffer(),
      });
      const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? `The upload failed (${response.status}).`);
      }

      input.value = result.url;
      say(`Uploaded ${result.url}. Save the form to reference it.`);
    } catch (error) {
      say(error instanceof Error ? error.message : 'The upload failed.', 'error');
    } finally {
      choose.disabled = false;
    }
  }

  show();
}
