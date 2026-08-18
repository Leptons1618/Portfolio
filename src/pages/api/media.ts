import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaPath } from '../../lib/media';

/**
 * Upload an image, without a commit and without a build.
 *
 * This is what `image-upload.ts` used to do through the GitHub Contents API:
 * base64 the bytes into a JSON body, commit them to `public/`, and wait for a
 * deploy before the image resolved. The bytes now go in the database and are
 * served by `/media/[...path]`, which means the field the author is filling in
 * points at something that already works.
 *
 * It also removes the last write this site made to the repository. Everything
 * else moved to D1; had images stayed, the GitHub App would still have needed
 * Contents:write for them alone — see decision 19 in `docs/DECISIONS.md`.
 *
 * Uploads replace by path, deliberately: re-uploading a hero image under the
 * same name updates every page referencing it, and there is no orphan to clean
 * up. The old behaviour — commit on pick, so a never-referenced upload is a
 * harmless orphan in `public/` — is preserved for the same reason it was
 * chosen: a frontmatter path to bytes that were never written is the failure
 * that actually hurts.
 */

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;
  const url = new URL(request.url);

  const dir = url.searchParams.get('dir') ?? '';
  const name = url.searchParams.get('name') ?? '';
  const mime = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();

  const extension = MEDIA_TYPES[mime];
  if (!extension) {
    return json({ error: `Unsupported image type: ${mime || 'none given'}.` }, 415);
  }

  let path: string;
  try {
    path = mediaPath(dir, name, extension);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Bad path.' }, 400);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: 'Empty upload.' }, 400);
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    const mb = (MAX_MEDIA_BYTES / 1024 / 1024).toFixed(1);
    return json(
      { error: `That image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${mb} MB.` },
      413,
    );
  }

  await DB.prepare(
    `INSERT INTO media (path, mime, bytes, size) VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       mime = excluded.mime,
       bytes = excluded.bytes,
       size = excluded.size,
       updated_at = datetime('now')`,
  )
    .bind(path, mime, bytes, bytes.byteLength)
    .run();

  // The URL the caller should store in a `heroImage` field.
  return json({ ok: true, url: `/media/${path}`, size: bytes.byteLength }, 201);
};
