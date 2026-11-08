/**
 * Public job boards, read without a credential.
 *
 * Greenhouse, Lever and Ashby each publish a company's open roles as JSON at an
 * unauthenticated URL, and all three answer `Access-Control-Allow-Origin: *` —
 * they exist so that third parties can build job sites. That is what lets this
 * file be called from two places: `portfolio jobs` in Node, and the Discover tab
 * of `/admin/jobs` in the browser. Neither goes through the Worker, and that is
 * the point: one board is several megabytes of JSON, and the free plan's 10 ms
 * of CPU (decision 61) would not parse it.
 *
 * It imports nothing, for the reason `content-schema.ts` imports nothing: the CLI
 * loads it directly and lets Node strip the types. `npm run check:cli` drives the
 * pure half against fixtures shaped like each vendor's real answer.
 *
 * LinkedIn is not here, and must not be — decision 78.
 */

export const BOARD_KINDS = ['greenhouse', 'lever', 'ashby'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export interface Board {
  kind: BoardKind;
  /** The company's board name: `stripe` in boards.greenhouse.io/stripe. */
  token: string;
  /** How the company is written on a row. Defaults to the token. */
  company?: string;
}

/** The `job-watchlist` document. Every list is matched case-insensitively. */
export interface Watchlist {
  boards: Board[];
  /** A posting's title must contain one of these. Empty matches every title. */
  keywords: string[];
  /** …and none of these. */
  exclude: string[];
  /** Its location must contain one of these. Empty matches anywhere. */
  locations: string[];
}

export const WATCHLIST_KEY = 'job-watchlist';

/** One posting, in the fields an `applications` row takes. */
export interface Posting {
  company: string;
  role: string;
  url: string;
  location: string;
  description: string;
}

/* A board name becomes a URL path segment. It is encoded as well, but a name
   that is not this shape is a typo worth refusing rather than a request. */
const TOKEN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

export function boardUrl(board: Board): string {
  if (!TOKEN.test(board.token)) throw new Error(`"${board.token}" is not a board name.`);
  const token = encodeURIComponent(board.token);
  switch (board.kind) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${token}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${token}`;
    default:
      throw new Error(`"${String(board.kind)}" is not a board this reads. One of: ${BOARD_KINDS.join(', ')}.`);
  }
}

/** Where a person would look at the board, for a link beside a failure. */
export function boardPage(board: Board): string {
  const token = encodeURIComponent(board.token);
  if (board.kind === 'greenhouse') return `https://job-boards.greenhouse.io/${token}`;
  if (board.kind === 'lever') return `https://jobs.lever.co/${token}`;
  return `https://jobs.ashbyhq.com/${token}`;
}

/* ---------- reading what came back ---------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/**
 * An advert's HTML as plain text.
 *
 * The result goes into a text column and is shown in a textarea and a terminal,
 * never parsed as HTML, so this only has to read well.
 * ponytail: a regex pass, not a parser — fine for advert prose; a parser is the
 * upgrade if a board ever ships markup this mangles.
 */
export function htmlToText(html: string): string {
  return tidy(
    decode(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<(br|\/p|\/div|\/h[1-6]|\/ul|\/ol)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

/** Runs of spaces to one, blank-looking lines to blank, at most one blank line in a row. */
function tidy(value: string): string {
  return value
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Json = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/* A board's link becomes an `href` on the admin screen, which is the origin
   holding the owner's token. A third party's `javascript:` is therefore not a
   link — it is a script one click away from that token — so anything but
   http(s) is no link at all, and a posting with no link is not offered. */
const webUrl = (value: unknown): string => (/^https?:\/\//i.test(text(value).trim()) ? text(value).trim() : '');
const objects = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((item): item is Json => Boolean(item) && typeof item === 'object') : [];
const joined = (parts: string[]): string => [...new Set(parts.map(part => part.trim()).filter(Boolean))].join(' / ');

/**
 * One vendor's answer as postings.
 *
 * Read defensively, like `normaliseModels()` reads a vendor's model list: this
 * is a third party's JSON, so a missing field is an empty string and a posting
 * with no title or no link is dropped rather than tracked.
 */
export function readBoard(board: Board, data: unknown): Posting[] {
  const company = board.company?.trim() || board.token;
  const root = (data && typeof data === 'object' ? data : {}) as Json;

  let postings: Posting[];
  switch (board.kind) {
    case 'greenhouse':
      /* `content` arrives entity-escaped — `&lt;p&gt;` — so it is decoded
         once into HTML before being read as HTML. */
      postings = objects(root.jobs).map(job => ({
        company,
        role: text(job.title),
        url: webUrl(job.absolute_url),
        location: text((job.location as Json | null)?.name),
        description: htmlToText(decode(text(job.content))),
      }));
      break;
    case 'lever':
      postings = objects(data).map(job => {
        const categories = (job.categories ?? {}) as Json;
        const all = Array.isArray(categories.allLocations) ? categories.allLocations.map(String) : [];
        const lists = objects(job.lists).map(item => `${text(item.text)}\n${htmlToText(text(item.content))}`);
        return {
          company,
          role: text(job.text),
          url: webUrl(job.hostedUrl),
          location: joined([text(categories.location), ...all]),
          description: tidy(
            [text(job.descriptionPlain), ...lists, text(job.additionalPlain)]
              .map(part => part.trim())
              .filter(Boolean)
              .join('\n\n'),
          ),
        };
      });
      break;
    case 'ashby':
      postings = objects(root.jobs)
        .filter(job => job.isListed !== false)
        .map(job => ({
          company,
          role: text(job.title),
          url: webUrl(job.jobUrl),
          location: joined([
            text(job.location),
            ...objects(job.secondaryLocations).map(place => text(place.location)),
            job.isRemote === true ? 'Remote' : '',
          ]),
          description: tidy(text(job.descriptionPlain)) || htmlToText(text(job.descriptionHtml)),
        }));
      break;
    default:
      return [];
  }
  return postings.filter(posting => posting.role && posting.url);
}

/* ---------- the watchlist ---------- */

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];

const isKind = (value: unknown): value is BoardKind => (BOARD_KINDS as readonly unknown[]).includes(value);

/**
 * A stored watchlist, whatever state it is in.
 *
 * The row is JSON anyone holding the owner's token can hand-edit, so it is
 * rebuilt here rather than trusted: a board of an unknown kind or with a name
 * that could not be a board is dropped, and a blank keyword is not a keyword —
 * a list of one empty string would otherwise match nothing at all.
 */
export function readWatchlist(raw: unknown): Watchlist {
  const source = (typeof raw === 'string' ? safeJson(raw) : raw) as Partial<Record<keyof Watchlist, unknown>> | null;
  const boards = objects(source?.boards)
    .filter(board => isKind(board.kind) && TOKEN.test(text(board.token)))
    .map(board => ({
      kind: board.kind as BoardKind,
      token: text(board.token),
      ...(text(board.company).trim() ? { company: text(board.company).trim() } : {}),
    }));
  return {
    boards,
    keywords: strings(source?.keywords),
    exclude: strings(source?.exclude),
    locations: strings(source?.locations),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** `greenhouse stripe Stripe Inc` — kind, board name, then the company as written. */
export function parseBoardLine(line: string): Board | null {
  const [kind, token, ...company] = line.trim().split(/\s+/);
  if (!isKind(kind?.toLowerCase()) || !token || !TOKEN.test(token)) return null;
  const name = company.join(' ').trim();
  return { kind: kind.toLowerCase() as BoardKind, token, ...(name ? { company: name } : {}) };
}

export const formatBoard = (board: Board): string =>
  [board.kind, board.token, board.company ?? ''].join(' ').trim();

const contains = (haystack: string, needles: string[]): boolean => {
  const lower = haystack.toLowerCase();
  return needles.some(needle => lower.includes(needle.toLowerCase()));
};

/** Title against keywords and exclusions, location against locations. */
export function matches(posting: Posting, list: Watchlist): boolean {
  if (list.keywords.length && !contains(posting.role, list.keywords)) return false;
  if (contains(posting.role, list.exclude)) return false;
  if (list.locations.length && !contains(posting.location, list.locations)) return false;
  return true;
}

const slugPart = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * `<company>-<role>`, short, and not one already in `taken` — which it joins.
 *
 * The same shape the `jobs` skill asks a model for, so a posting tracked from a
 * board and one tracked from a pasted advert are named alike.
 */
export function postingSlug(posting: Pick<Posting, 'company' | 'role'>, taken: Set<string>): string {
  const base =
    [slugPart(posting.company), slugPart(posting.role)].filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '') ||
    'application';
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/* ---------- fetching ---------- */

export async function fetchBoard(board: Board, signal?: AbortSignal): Promise<Posting[]> {
  const response = await fetch(boardUrl(board), { signal, headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error(`${board.kind} has no board called "${board.token}".`);
  if (!response.ok) throw new Error(`${board.kind}/${board.token} answered ${response.status}.`);
  return readBoard(board, await response.json());
}

export interface Scan {
  /** Matching postings whose URL is not already tracked. */
  found: Posting[];
  /** Postings read across every board that answered. */
  seen: number;
  failed: { board: Board; reason: string }[];
}

/**
 * Every board on the list, at once; what matches and is not tracked yet.
 *
 * A board that fails is reported and does not stop the rest — one company
 * moving off Lever should not hide the other nine. Tracked is by URL, exactly:
 * Greenhouse's `?gh_jid=` is the posting's identity, so no query is stripped.
 */
export async function scan(list: Watchlist, trackedUrls: Iterable<string>, signal?: AbortSignal): Promise<Scan> {
  const known = new Set([...trackedUrls].map(url => url.trim()));
  const results = await Promise.allSettled(list.boards.map(board => fetchBoard(board, signal)));

  const found: Posting[] = [];
  const failed: Scan['failed'] = [];
  let seen = 0;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failed.push({ board: list.boards[index], reason });
      return;
    }
    seen += result.value.length;
    for (const posting of result.value) {
      if (known.has(posting.url) || !matches(posting, list)) continue;
      known.add(posting.url);
      found.push(posting);
    }
  });
  return { found, seen, failed };
}
