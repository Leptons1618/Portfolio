# Case studies as an overview and chapters, with drawings that stay editable

**Date:** 2026-11-09 · **Status:** design approved in conversation, spec awaiting review
**Decisions this will record:** 81 (chapters and the overview facts), 82 (Excalidraw, extending 25)

## Why

A case study has to serve two readers. A recruiter gives it a minute: what it is, what the owner did,
what it achieved, the stack, one picture. A programmer wants the deep dive: the architecture, the
decisions, the hard parts. Today's page is one column — a fixed Problem and Solution, an optional
architecture image, achievements, stack, then one markdown write-up — so the first reader has to dig
for the facts and the second reader scrolls one very long page.

Three gaps in the authoring surface make that worse:

- **Diagrams are not editable.** `/draw-diagram` turns model-written Mermaid into an SVG and stores
  the SVG only (decision 25). Changing an arrow means regenerating the whole diagram.
- **Images cannot be pasted or dropped into a write-up.** The only door is the upload control beside
  an image *field*; a body gets an image by uploading elsewhere and typing the path.
- **Nothing helps structure a write-up by kind of project.** An ML project and a CLI tool are
  explained differently, and the editor offers the same blank textarea for both.

## What it is

1. **Overview + chapters.** `/case-studies/[slug]` is the overview; each `## ` section of the
   write-up can be its own page at `/case-studies/[slug]/[chapter]`. Opt-in per study.
2. **Overview facts.** Role, team, up to four key numbers, and labelled links.
3. **Paste or drop images** into the journal body and the case-study write-up.
4. **Excalidraw drawings** — edited on the admin, served to readers as a plain SVG that carries its
   own scene, so it can be reopened and edited.
5. **A chapter outline per category**, offered to the author and used by the long case-study writer.

Out of scope: live/interactive diagrams on public pages (rejected below), a timeline/dates field (not
chosen), per-chapter SEO metadata beyond title and description, and any change to journal posts other
than paste/drop and Draw.

## Data

Migration `0016_case_study_chapters.sql` adds five columns to `case_studies`:

| column | type | example | notes |
| --- | --- | --- | --- |
| `role` | `TEXT` | `Solo — design, backend, ML` | optional |
| `team` | `TEXT` | `Solo`, `4 engineers` | optional |
| `metrics` | `TEXT NOT NULL DEFAULT '[]'` | `["40% \| latency cut"]` | list; at most four rendered |
| `links` | `TEXT NOT NULL DEFAULT '[]'` | `["Docs \| https://…"]` | list |
| `paged` | `INTEGER NOT NULL DEFAULT 0 CHECK (paged IN (0,1))` | `1` | split into chapters |

- **`metrics` and `links` use the existing `list` encoder** — a JSON array of strings, one per line in
  the editor, each split on its first ` | ` at render time. The write boundary, the CLI and the MCP
  server need no new encoder; `content-schema.ts` gains five entries (`role`/`team` `text`,
  `metrics`/`links` `list`, `paged` `bool`).
- **A link whose URL is not `http:` or `https:` is dropped at render**, the rule `job-boards.ts`
  applies, because the value becomes an `href` on this origin. A line without ` | ` is shown as a
  label-less link only if it is itself an http(s) URL; a metric line without ` | ` is its value alone.
- **`paged` defaults to 0**, so the seventeen existing case studies render exactly as before on
  deploy. Many already have six to eight `## ` sections from the long writer; turning a two-minute
  read into three one-paragraph pages would be worse, so the author opts in per study.
- **No model writes `role`, `team`, `metrics` or `links`.** `CASE_STUDY_KEYS` does not gain them,
  so no assistant task can produce them. Several case studies on this site were found to be
  fabricated; an invented number in front of a recruiter is the worst failure this feature could have.
  `.claude/skills/portfolio/SKILL.md` says a metric comes from the owner or a measurement in the repo.
- `content.ts` reads the new columns into `CaseStudyData`; `content-store.ts` sends them;
  `explainConstraint()` needs nothing new (no new NOT NULL without a default).

## Chapters

`src/lib/chapters.ts` — imports nothing at runtime (type-only `Category`), so `check:markdown` can
load it in plain Node.

- **`splitChapters(html)`** → `{ intro: string, chapters: { id, title, html }[] }`. It splits the
  stored `body_html` at each `<h2 id="…">`, which `renderBody()` already emits
  (`<h2 id="core-engineering-decisions">`). Text before the first `h2` is the intro. `title` is the
  heading's text content (tags stripped, entities kept as rendered). A body with no `h2` has no
  chapters. Splitting on read rather than on write keeps one stored body and no second column to drift.
- **`metricsOf(list)` / `linksOf(list)`** — the ` | ` split and the http(s) filter, pure.
- **`CHAPTER_OUTLINES: Record<Category, string[]>`** — typed against `Category`, so adding a category
  fails the typecheck until it has an outline:
  - `ml-cv`: Data and labelling · Model · Training and evaluation · Inference pipeline · Results and limits
  - `ai-llm`: Architecture · Retrieval, prompting and the agent loop · Evaluation and guardrails · Deployment · Results and limits
  - `full-stack`: Architecture · Data model · API · Frontend · Deployment and operations · Results
  - `devtools`: Design · Internals · Developer experience · Trade-offs · Results
  - `systems`: Design · Internals · Performance · Trade-offs · Results
  - `simulation`: The model · The engine · Visualisation · Validation · Results
  - `other`: Context · Approach · Implementation · Results

## Public pages

**`/case-studies/[slug]` — the overview.** `CaseStudyLayout` gains:

- a facts line under the subtitle: role · team (each only when set);
- two to four metric cards (value large, label small) when `metrics` is non-empty;
- links beside Repo/Demo in the Stack section's actions;
- when `paged` is on and there are chapters: the intro, then a numbered chapter list (number, title,
  the chapter's first sentence) linking to each chapter, in place of the full write-up;
- when `paged` is off, or there are no chapters: the whole write-up, as today.

**`/case-studies/[slug]/[chapter]` — new route, `prerender = false`.** A two-column page: a sticky
chapter rail (Overview, then 1…n with the current one marked, `aria-current="page"`), the chapter's
HTML in `.prose`, and previous/next links within the study (the last chapter's next is the overview).
Title `<chapter> — <study title>`; description the chapter's first sentence; canonical its own URL.

- An unknown chapter id (a heading renamed since a link was shared) → **302 to the overview**.
- `paged` off → **302 to `/case-studies/[slug]#<id>`**, which lands on the heading in the full page.
- An unknown or retired study → the same empty 404 the overview gives (`getCaseStudy` +
  the hidden-project retirement already in `content.ts`).
- Below 860px the rail becomes a horizontal, scrollable strip above the chapter. Print hides it
  (`@media screen` for the layout, per the print rule in CLAUDE.md).

**`/projects/[slug]`** — the case-study card shows the metric cards when there are any. A recruiter
often lands on the project page first.

**Click to enlarge.** An image inside a case study's `.prose` (overview or chapter) or the architecture
figure opens in a native `<dialog>` at full width on click or Enter; Escape and the backdrop close it.
About twenty lines in the layout's script; nothing loaded.

**Dark mode for drawings.** Excalidraw exports dark strokes on white. Under the site's dark mode (the
`data-mode="dark"` attribute, and the `prefers-color-scheme` default when `data-mode` is absent — the
same two-selector arrangement the theme files use), `img[src^="/media/images/drawings/"]` gets
`filter: invert(0.93) hue-rotate(180deg)` — what Excalidraw's own dark mode does. Mermaid diagrams
under `/media/images/diagrams/` bake their colours (decision 25) and are untouched.

**Edge cache.** The chapter route is public HTML, so the middleware stores it like every other page.
`affected('case_studies', slug, chapterIds)` grows an optional third argument; `POST /api/content`
passes the ids from the `body_html` it has just rendered, so a save purges every current chapter URL.
It also purges the linking project's page (`/projects/<slug>`), which now shows the metrics. Known
limit, stated in the decision: a chapter whose heading was renamed by this save keeps its old cached
copy at the old URL for up to `s-maxage` (60s) before the route answers it with a redirect.

## Authoring

### Paste or drop an image into a write-up

`attachMarkdownImages(textarea, { dir, name })` in `src/lib/image-upload.ts`, reusing that module's
upload helper — same `POST /api/media`, `MEDIA_TYPES`, and 2,000,000-byte ceiling.

- Acts only when the `paste` or `drop` carries at least one image **file** and is not rich text;
  then it calls `preventDefault()`. Rich text from Word or a web page carries `text/plain` *and*
  `text/html` (sometimes with an image alongside) and pastes as text. A screenshot (no text),
  a browser's Copy image (HTML, no plain text) and a file copied in Finder (its name as plain text,
  no HTML) all upload. *(Refined during implementation: the first wording — "files and no plain
  text" — would have pasted a Finder-copied file's name instead of the image.)*
- Per file: insert `![Uploading <stem>…]()` at the caret with `setRangeText` (the native undo stack
  survives), upload, then replace that exact placeholder with `![<stem>](/media/…)`. On failure the
  placeholder is removed and `toast()` says why (type, size, signed out).
- The placeholder find/replace is pure (`md-edit.ts`) so `check:editor` covers it.
- Mounted on the journal body (`images/journal`) and the case-study write-up (`images/case-studies`).
  The existing upload frames accept a paste while focused.

### The Excalidraw editor

`src/lib/drawing.ts` (browser): `openDrawing({ src?, name }): Promise<string | null>`.

- Builds one full-screen native `<dialog>` lazily (rebuilt when not `isConnected`, like
  `media-library.ts`) and **dynamically imports** `react`, `react-dom/client`, `@excalidraw/excalidraw`
  and its stylesheet when first opened. Pinned: `@excalidraw/excalidraw@0.18.x`, `react`/`react-dom@19`.
- **Open:** blank, or from `src` — a `/media/images/drawings/*.svg` is fetched and handed to
  `loadFromBlob`, which reads back the scene the export embedded.
- **Save:** `exportToSvg({ elements, files, appState: { …, exportEmbedScene: true,
  exportBackground: true } })`, serialised, checked against `MAX_MEDIA_BYTES` (an embedded pasted
  bitmap can exceed it; the message says so), uploaded to `images/drawings/<name>.svg`, resolves with
  the URL. Saving an edited drawing overwrites its path — `/api/media` upserts and purges, and `/media`
  is `max-age=60`.
- **Cancel** resolves `null`; closing with unsaved changes asks first (`confirm()` inside the dialog).
- **Mermaid:** Excalidraw's built-in "Mermaid to Excalidraw" import runs locally. If the pinned
  version does not expose it without an AI backend, the dialog adds a **From Mermaid** button that
  calls `parseMermaidToExcalidraw` + `convertToExcalidrawElements` (`@excalidraw/mermaid-to-excalidraw`
  is already an Excalidraw dependency).
- **Fonts:** while editing, Excalidraw loads its fonts from its default CDN — accepted on the owner's
  admin. The exported SVG embeds the glyphs it uses, so a reader's `<img>` fetches nothing.
- **Entry points:** a **Draw** button by the journal body and the case-study write-up inserts
  `![Drawing](/media/images/drawings/<slug>-<base36>.svg)` at the caret; **Edit drawing** appears when
  the caret is on a drawing's image line (`drawingAt(text, caret)` in `md-edit.ts`, pure) and reopens
  it; **Draw** / **Edit** on the architecture image field.
- Styles for the dialog live in `admin.css` (script-built DOM carries no `data-astro-cid`).

**The import guard.** `check:content` fails when any file other than `src/lib/drawing.ts` imports
`@excalidraw/*`, `react` or `react-dom`, or when any file imports `drawing.ts` other than through a
dynamic `import()`. That is what keeps decision 25's property — no drawing library on a public page,
none in the admin bundle until used.

### Fields, switch and outline on the case-study tab

- **Role**, **Team** inputs; **Metrics** and **Links** textareas (one per line, placeholders
  `40% | latency cut` and `Docs | https://…`), filled and saved with the rest of the case study by
  `patchCaseStudy`.
- **Split into chapters** — a checkbox, so `switch.ts` mounts it as a switch.
- Under the write-up, a live list of its `## ` headings — "what the chapters will be".
- **Insert outline** puts the category's `CHAPTER_OUTLINES` at the caret: each as `## Heading` with an
  italic line under it saying what to cover. Not an HTML comment — `safeMarkdown` escapes raw HTML, so
  a comment would print.

## Assistant changes

- `AssistField` gains `category` (with a `CONTEXT_LIMITS` cap and a `CONTEXT_LABELS` entry); the
  project screen sends the form's category.
- `casestudyplan` lists `category` in its context, and its fixed "good arc" line is replaced by:
  plan from the outline for the given category, adapted to the actual work. `parsePlan()`'s default
  arc becomes the category's outline.
- `CASE_STUDY_KEYS` is unchanged — no task can write the four overview facts or `paged`.

## Checks

| check | asserts |
| --- | --- |
| `check:markdown` | `splitChapters()` on real `renderBody()` output: intro, ids, titles, a heading with inline code, a body with no `h2`; `metricsOf`/`linksOf` splitting; **`javascript:`, `data:` and relative links dropped** |
| `check:schema` | the five columns accepted with their encoders; an unknown key still refused |
| `check:edge` | `affected('case_studies', slug, ids)` names every chapter URL; without ids it is unchanged |
| `check:editor` | the paste placeholder insert/replace; `drawingAt()` |
| `check:ai` | `casestudyplan` carries `category`, capped; `CASE_STUDY_KEYS` has no overview fact |
| `check:content` | the chapter route declares `prerender = false` (existing gate); the Excalidraw import guard |
| `check:cli` | unchanged — and still green, since the CLI holds no column names |

Then `npm run check`, `npm run build` (a public page's only script is still the chat widget; the
Excalidraw chunk exists and nothing public references it), and a local run under `wrangler dev` with
local D1: paste, drop, draw, save, reopen, chapter pages, redirects, dark mode, print.

## Rejected

- **Live Excalidraw on public pages** — React + Excalidraw (~1 MB gzipped) for every case-study reader,
  which reverses decision 25 and the reason pages are static. Click-to-enlarge covers the need to see
  detail.
- **A `diagrams` table holding the scene** — a table, a write path and a test to store what the SVG
  already carries.
- **A chapters table** — chapters are headings in one markdown body; a table would split the editor and
  the assistant's output into rows for no reader-visible gain.
- **Tabs on one page** — hidden content is invisible to find-in-page and has no URL.
- **Splitting automatically by length** — a threshold is a guess; the author decides with `paged`.
- **New encoders for metrics and links** — a structured `json` encoder would touch the trust boundary,
  the CLI and the MCP server for what a ` | ` split at render does.

## Docs

Decisions 81 and 82; `CHANGELOG.md` (Added); CLAUDE.md's `case_studies` paragraph and two new
`src/lib/` entries (`chapters.ts`, `drawing.ts`); `.claude/rules/admin-surface.md` (the case-study tab,
paste/drop, the drawing dialog); `.claude/skills/portfolio/SKILL.md` (the new fields, metrics are never
invented); `/colophon` FACTS if a count changes.
