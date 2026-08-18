import type { APIRoute } from 'astro';
import { MEDIA_MIME, mediaBytes } from '../../lib/media';

/**
 * Serve an uploaded image out of the database.
 *
 * The counterpart to `POST /api/media`. Nothing else reads the `media` table,
 * which is what keeps the choice of where bytes live a one-table decision: if
 * images ever outgrow D1's 2 MB-per-blob ceiling, this is the only file that
 * has to learn about R2.
 *
 * The images that ship with the repository — the portrait and the OG default —
 * are not in here. They are site chrome referenced from `src/lib/site.ts`, they
 * change when the design changes rather than when content does, and they are
 * already static assets that Cloudflare serves without waking the Worker.
 */

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const path = params.path ?? '';
  const { DB } = locals.runtime.env;

  /* `bytes` is deliberately typed `unknown`. It used to be declared
     `ArrayBuffer`, which was an assertion rather than a conversion — D1 returns
     a BLOB as a `number[]`, `Response` stringified it, and every image on this
     site was served as a comma-separated list of decimal byte values under an
     `image/jpeg` header. `mediaBytes()` is the conversion, and saying `unknown`
     here is what stops the next person from asserting the answer again. */
  const row = await DB.prepare('SELECT mime, bytes, updated_at FROM media WHERE path = ?')
    .bind(path)
    .first<{ mime: string; bytes: unknown; updated_at: string }>();

  if (!row) return new Response('Not found', { status: 404 });

  /* Trust the stored MIME only if it is one we accepted on the way in. The
     upload endpoint already restricted it, and re-deriving from the extension
     means a row edited by hand cannot turn an image route into a way to serve
     arbitrary content types. */
  const extension = path.split('.').pop() ?? '';
  const type = MEDIA_MIME[extension] ?? 'application/octet-stream';

  const bytes = mediaBytes(row.bytes);

  return new Response(bytes, {
    headers: {
      'Content-Type': type,
      /* From the bytes actually being sent, not from the `size` column: the two
         agree, and the one that would be wrong if they ever stopped agreeing is
         the one that was not measured here. */
      'Content-Length': String(bytes.byteLength),
      /* An upload replaces by path, so a URL's bytes *can* change. A year-long
         immutable cache would strand the old image in every reader's browser;
         a short shared cache keeps the database out of the hot path while
         letting a re-upload actually show up. */
      'Cache-Control': 'public, max-age=60, s-maxage=86400',
      ETag: `"${row.updated_at}"`,
    },
  });
};
