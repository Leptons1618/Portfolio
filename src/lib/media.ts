/**
 * What counts as an uploadable image, and where it lands.
 *
 * Shared by the upload endpoint, the route that serves the bytes back, and the
 * browser control that picks the file, so "which types are allowed" and "what
 * path does this become" are answered identically on both sides of the wire
 * rather than drifting between a client check and a server one.
 */

/**
 * MIME → extension, because a file's own name is not to be trusted for it: a
 * browser will happily hand over `screenshot` with no extension at all, and the
 * extension is what decides the content type on the way back out.
 */
export const MEDIA_TYPES: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

/** Reverse of the above, for setting `Content-Type` when serving. */
export const MEDIA_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_TYPES).map(([mime, extension]) => [extension, mime]),
);

/**
 * D1's own ceiling for one BLOB, so this is a hard limit rather than a policy.
 *
 * Note it is 2,000,000 bytes and **not** 2 MiB — Cloudflare documents the
 * figure in decimal. Writing `2 * 1024 * 1024` here leaves a 97 KB window in
 * which this check passes and the database then refuses the write, turning a
 * clear "that image is too large" into an opaque constraint error from a layer
 * the author cannot see. `scripts/test-content-schema.mjs` asserts the
 * relationship so it cannot drift back.
 *
 * It is not a limitation in practice: every image on this site is a photograph
 * or a diagram shown at most a column wide, and the portrait that ships with
 * the repo is 21 KB. Anything near this limit is an original that wanted
 * resizing before it wanted uploading.
 *
 * ponytail: move the `media` table to R2 if this ever binds — nothing but
 * `/media/[...path]` reads it.
 */
export const MAX_MEDIA_BYTES = 2_000_000;

/**
 * Whatever D1 handed back for a BLOB column, as bytes that can be a response.
 *
 * **D1 does not return an `ArrayBuffer`.** A BLOB comes back as a plain
 * `number[]` — one element per byte — because D1's wire format is JSON and JSON
 * has no binary type. Miniflare's local D1 does the same, so this is not a
 * development-only quirk.
 *
 * `/media/[...path]` declared the column as `ArrayBuffer` in the type parameter
 * of `first<…>()`, which is an *assertion*: it changes what TypeScript believes
 * and converts nothing. `new Response(anArray)` then does what `Response` does
 * with any non-body object — stringifies it — so every uploaded image was
 * served as `200 OK`, `Content-Type: image/jpeg`, with a body reading
 * `255,216,255,224,0,16,74,70,73,70,…`. The bytes were in the database the
 * whole time and the URL was right; the response was a text rendering of them,
 * which decodes to no image at all. On screen that is an upload control saying
 * "Nothing loads from that path" about a path that is perfectly correct.
 *
 * Nothing catches this by type: the assertion is the bug, so the compiler was
 * being told the answer rather than checking it. Hence a runtime conversion
 * that accepts every shape a D1 driver might plausibly return, and a test.
 */
export function mediaBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  /* The shape D1 actually returns, and the one the bug was about. */
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  /* A typed array or a `DataView`, possibly a window onto a larger buffer.
     Copied into a buffer of its own rather than wrapped: a view carries only
     part of what it is backed by, and handing `Response` the whole backing
     store would append whatever is next to the image. The copy also gives the
     return type an `ArrayBuffer` it definitely owns, which is what `BodyInit`
     asks for — a `SharedArrayBuffer` is not a valid body, and asserting that
     one is not present is the class of shortcut that caused this bug. */
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return bytes;
  }
  throw new Error(`Unsupported BLOB shape from D1: ${Object.prototype.toString.call(value)}`);
}

/** One path segment: no dots, no slashes, so nothing can climb out of `dir`. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Build the storage path for an upload, or throw.
 *
 * `dir` and `name` arrive from the browser, and the result is a primary key
 * that `/media/[...path]` will later echo back into a URL — so both halves are
 * validated segment by segment rather than pattern-matched for `..`. An
 * allowlist of safe segments cannot be talked into a traversal; a denylist of
 * dangerous ones has to be right every time.
 */
export function mediaPath(dir: string, name: string, extension: string): string {
  const segments = dir.split('/').filter(Boolean);
  if (!segments.length) throw new Error('Missing upload directory.');
  if (!segments.every(s => SEGMENT.test(s))) throw new Error(`Bad upload directory: ${dir}`);
  if (!SEGMENT.test(name)) throw new Error(`Bad file name: ${name}`);
  return `${segments.join('/')}/${name}.${extension}`;
}
