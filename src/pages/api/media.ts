import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { record } from '../../lib/log';
import { purge } from '../../lib/edge-cache';
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
 *
 * **Replacing by path is what makes the purge necessary.** `/media/[...path]`
 * asks for a shared cache, and `src/middleware.ts` gives it one — so the URL
 * whose bytes just changed was the URL still answering with the old bytes, for
 * far longer than anyone would look for a cache before concluding the upload
 * had silently failed. A delete was worse: the row was gone and the image kept
 * being served. Both call `purge()` now; `src/lib/edge-cache.ts` is honest
 * about the colo it reaches.
 */

export const prerender = false;

/**
 * What has already been uploaded — the media library's index.
 *
 * Without this, the only way to reference an existing image was to remember its
 * path and retype it, which is how a field ends up pointing at bytes that were
 * never written under quite that name. The modal in `src/lib/media-library.ts`
 * is the reader.
 *
 * **`bytes` is deliberately not selected.** It is the whole point of the table
 * and up to 2 MB a row; a listing that fetched it would pull the entire library
 * through the Worker to render a grid of thumbnails, which the `/media/…` URLs
 * already serve one at a time and with a cache in front.
 *
 * Owner-only, like every other route here. The bytes themselves are public to
 * anyone holding a path — they are page images — but the *index* of everything
 * ever uploaded is not something to hand out, and the only screens that need it
 * are already behind a session.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  /* Newest first, because the thing just uploaded is overwhelmingly the thing
     being looked for. The cap is a guard rather than a paging scheme: this is a
     personal portfolio, and a library that outgrows it wants a search endpoint
     rather than a longer list. */
  const { results } = await DB.prepare(
    'SELECT path, mime, size, updated_at FROM media ORDER BY updated_at DESC LIMIT 200',
  ).all<{ path: string; mime: string; size: number; updated_at: string }>();

  return json({
    items: (results ?? []).map(row => ({
      path: row.path,
      url: `/media/${row.path}`,
      mime: row.mime,
      size: row.size,
      updatedAt: row.updated_at,
    })),
  });
};

/**
 * Remove one upload.
 *
 * The table had no remover at all, which made every upload permanent: the
 * control uploads on pick (deliberately — an unreferenced upload is harmless and
 * a saved path to bytes that were never written is not), so a mistyped name or a
 * replaced hero image left a row nobody could reach and nothing could clear
 * short of `wrangler d1 execute`. At up to 2 MB a row against the free tier's
 * storage that is not a tidiness question.
 *
 * Owner-only like the rest of the route. `path` is bound as a value — it never
 * becomes an identifier and it is not a filesystem path, so there is nothing
 * here for a traversal to reach; the thing to get right is that a path which
 * matches nothing says so rather than reporting a delete that did not happen.
 *
 * Nothing checks whether a page still references the bytes, and that is the same
 * bargain as everywhere else on this surface: a `heroImage` pointing at a
 * deleted upload renders a broken image, which is visible, where a delete that
 * silently refused would not be. The Media library lists what exists.
 */
export const DELETE: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  /* Both spellings, because the caller has a `/media/…` URL in hand — it is
     what the upload returned and what the field it filled in holds. */
  const path = (url.searchParams.get('path') ?? '').replace(/^\/?media\//, '');
  if (!path) return json({ error: 'Which path? Pass ?path=dir/name.ext.' }, 400);

  const { meta } = await DB.prepare('DELETE FROM media WHERE path = ?').bind(path).run();
  if (meta.changes === 0) return json({ error: `Nothing uploaded at /media/${path}.` }, 404);

  await record(DB, 'warn', 'media', `Deleted /media/${path}.`, { path });
  purge(url, [`/media/${path}`], locals.runtime.ctx);
  return json({ ok: true, path });
};

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

  await record(DB, 'info', 'media', `Uploaded /media/${path}.`, { path, mime, size: bytes.byteLength });
  /* An upload is an upsert, so this is as likely to be a replacement as a new
     path — and a replacement whose URL is already cached is the whole reason
     this line exists. Purging a path that was never cached costs nothing. */
  purge(url, [`/media/${path}`], locals.runtime.ctx);

  // The URL the caller should store in a `heroImage` field.
  return json({ ok: true, url: `/media/${path}`, size: bytes.byteLength }, 201);
};
