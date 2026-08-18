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
