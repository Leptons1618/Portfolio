# The application screen becomes a workspace: read first, act second

**Date:** 2026-11-10 · **Status:** implemented
**Screen:** `/admin/jobs/[slug]` (`src/pages/admin/jobs/[slug].astro`)
**Decision this will record:** 83
**Who does what:** an implementing agent (CommandCode) builds this phase by phase. The planner
reviews each phase's diff before the next one starts. Section 10 is the working agreement.

---

## 1. Why

The screen today is one form: twelve inputs in two cards. That is the right shape for *typing a row
in* and the wrong shape for *using* one.

- **The advert is a monospace textarea.** A thousand-word posting is read through a ten-row box.
- **The fit assessment is raw markdown in a textarea.** `**Verdict:**`, `###` and `- ✅` are shown
  as typed. The single most useful artefact on the page is the least readable thing on it.
- **Contacts are lines of text.** Two people, their titles and their profile URLs are one string
  each; there is nothing to click and nothing to copy.
- **Outreach drafts live in the assistant panel and nowhere else.** Close the panel and the
  message is gone unless the conversation happens to be saved. There is no "the note I sent Priya".
- **Nothing says what to do next.** The owner has to know that the order is: assess → pick or build
  a resume → find a way in → apply → follow up.

The owner's use is a workflow, repeated per role: *understand the job, see how I compare, tailor
the resume, pick the projects that make the case, ask for a referral, write to the recruiter, track
it.* The screen should be that workflow, with every piece of text one click from the clipboard.

## 2. What it becomes

One screen, four tabs, and the form moves into a dialog.

```
MODULE: JOBS / APPLICATION
Acme — Full-Stack Builder                 [Posting ↗] [Assistant] [⋯] [Save]
[Saved ▾]  [Reasonable · 6/10]  [AI-Native Full-Stack Builder]  next: Ask Arjun… · no date
┌──────────────────────────────────────────────────────────────────────────────┐
│ NEXT  Ask for a referral before applying — you have a contact who is an alum. │
│                                                        [Draft the ask →]      │
└──────────────────────────────────────────────────────────────────────────────┘
 Overview │ Fit │ Resume & projects │ Outreach
```

| Tab | Question it answers | What is on it |
| --- | --- | --- |
| **Overview** | What is this job and where does it stand? | The advert, readable. A rail: status, dates, next step, resume sent, contacts at a glance, fit at a glance, notes. |
| **Fit** | How do I compare? | Verdict and score, then a two-column comparison — *the role asks for* against *your record shows* — per requirement. Gaps, keywords, anything else the assessment said. |
| **Resume & projects** | What do I send? | The variant picked and what it says. The projects to lead with for this role, each with its one line. Missing keywords. A hand-off to the Resume screen to build a variant from this advert. |
| **Outreach** | Who do I write to, and what do I say? | One card per contact. Per card, a button per kind of message; drafts with a live character count against the channel's limit; Copy; Keep; Mark sent. |

Everything that used to be an input still exists and is still the value (section 5) — what changes
is that the owner reads a rendered view and opens an editor only to edit.

## 3. Constraints that are not negotiable

Read `CLAUDE.md`, `.claude/rules/admin-surface.md` and `.claude/rules/ai-assistant.md` before
writing a line. The ones this work is most likely to break:

1. **No row is ever server-rendered.** The page renders the slug from its own URL and nothing else;
   the row arrives over `GET /api/content` with the token. Every element showing application data
   is built in script. Decision 80.
2. **Script-built DOM gets no `data-astro-cid`**, so its rules go in `src/styles/admin.css` under a
   `.jw-*` prefix — never in the page's `<style>`. The page's own `<style>` is for the
   server-rendered shell only.
3. **Nothing from a row or a model is inserted as HTML**, with one existing exception: a string
   returned by `POST /api/preview` (which is `renderBody()` — sanitised on the server) may be
   assigned to a `.prose` node, exactly as `JournalEditor.astro` does. Everything else is
   `createElement` + `textContent`.
4. **A URL from a row becomes an `href` only if it is absolute http(s).** Contacts carry profile
   URLs; anything else is text.
5. **The assistant never writes a row.** A run writes into the form; Save writes the row. This
   screen keeps one Save button and one dirty tracker (`trackDirty`). No autosave.
6. **Never write `textContent` onto a button** — use `setLabel()` / `setBusy()`.
7. **Spacing tokens are `--space-1/2/3/4/6/8` only.** No hex, no font names, no px a token carries.
   A bare `var(--space-5)` silently zeroes the declaration.
8. **Tabs are `wireTabs()`**; a tab panel must not also carry a page-scoped layout class (put the
   layout on a child). Dialogs are native `<dialog class="modal">` in three bands, with `display`
   declared on `.modal[open]` only.
9. **`/api/ai/assist` takes a task name, never a prompt.** No new endpoint, no new task (section 6
   reuses the two that exist). `check:ai` pins that the `job` surface offers exactly
   `['jobFit', 'jobOutreach']` — that list must not change.
10. **Nothing touches linkedin.com** — no fetch, no embed, no preview. A profile link is an `<a
    target="_blank" rel="noopener noreferrer">` the owner clicks. **Nothing is ever sent.**
11. **Application data stays private.** Nothing from this table reaches a public page, the sitemap,
    `ai-corpus.ts`, a log row's text, or a URL query string (the advert must not be handed to the
    Resume screen through a URL — section 7).
12. **No new dependency.** No React, no markdown library, no UI kit.
13. **No agent or tool attribution** in any commit message, PR title or PR body. No
    `Co-Authored-By`, no "Generated with". The user's global rule; it outranks any tool default.

## 4. Data

One new column. `migrations/0017_application_outreach.sql`:

```sql
-- The drafts the owner kept, as markdown: one `## Contact · Channel` section each.
-- Text rather than JSON for the reason `fit` is: it is read and edited by a person.
ALTER TABLE applications ADD COLUMN outreach TEXT;
```

- `src/lib/content-schema.ts` — add `outreach: ['outreach', 'text']` to `APPLICATION_COLUMNS`.
- `src/lib/content-store.ts` — add `outreach: string | null` to `ApplicationFields`.
- `scripts/test-content-schema.mjs` — add the case (a column added without one is the thing that
  script exists to catch).
- `cli/` and `mcp/` need **no edit** — they have no field table. `check:cli` fails if a column name
  appears in the CLI; do not add one.
- Migration numbering: `0016_case_study_chapters.sql` belongs to another branch. **Confirm the
  highest number on `main` before naming this file**, and see section 10 on branching.

Stored shape of `outreach`:

```markdown
## Priya Nair · LinkedIn note
Hi Priya, I build MCP servers and agent tooling end to end…

## Arjun Mehta · Referral ask
Hi Arjun, we overlapped at Initech…
```

One section per contact-and-channel pair; keeping a new draft for the same pair replaces the old
one. The heading is `<contact name> · <channel label>`.

**Everything else is derived on read, not stored.** The comparison table is parsed out of `fit`;
contact cards are parsed out of `contacts`; "projects to lead with" is a section of `fit`. That is
the same arrangement as `chapters.ts` cutting one stored body into chapters — one source of truth,
and the CLI, the MCP server and the `jobs` skill keep working on plain markdown.

## 5. `src/lib/job-view.ts` — the one new module

Pure functions, **imports nothing at runtime** (so `scripts/test-cli.mjs` can drive it in plain
Node, the way it drives `job-boards.ts`). No DOM in this file.

```ts
export type Mark = 'met' | 'adjacent' | 'missing';
export interface FitItem { mark: Mark; requirement: string; evidence: string }
export interface FitView {
  recognised: boolean;                    // false → the screen shows the text as prose instead
  verdict: { level: 'Strong' | 'Reasonable' | 'Stretch' | 'Poor' | null; why: string };
  score: { value: number | null; why: string };          // n of "n/10"
  must: FitItem[];
  nice: FitItem[];
  gaps: string[];
  keywords: string[];
  projects: { slug: string; line: string }[];            // "### Projects to lead with"
  extra: { title: string; markdown: string }[];          // every other ### section, in order
}
export function parseFit(markdown: string): FitView;

export interface Contact { name: string; title: string; url: string | null; raw: string }
export function parseContact(line: string): Contact;
export function formatContact(contact: Omit<Contact, 'raw'>): string;   // "Name — title — url"

export const OUTREACH_CHANNELS = { /* closed table, below */ } as const;
export type Channel = keyof typeof OUTREACH_CHANNELS;
export interface Draft { contact: string; channel: string; text: string }
export function parseOutreach(markdown: string): Draft[];
export function formatOutreach(drafts: Draft[]): string;
export function outreachInstruction(contact: Contact, channel: Channel, appliedOn?: string): string;
export function measure(text: string, channel: Channel): { count: number; limit: number; unit: 'characters' | 'words'; over: boolean };

export interface NextAction { text: string; button: string; tab: 'overview' | 'fit' | 'resume' | 'outreach'; act?: 'assess' | 'draft' | 'applied' }
export function nextAction(fields: {...}, today: string): NextAction;

export function peopleSearches(company: string, role: string): string[];
```

### `parseFit` — written against real data, not the template

Stored assessments were written by more than one author (the screen's task, and a model working
through the `jobs` skill), so the parser must take all of this:

- `**Verdict:** Reasonable — why.` and `**Score:** 6/10 — why.` as the first lines. Level is the
  first word after the label, matched case-insensitively against the four; anything else is `null`
  with the whole remainder in `why`.
- `### Must-haves` / `### Nice-to-haves` — match on `must` and `nice`, case-insensitive, so
  "Must haves" and "Nice to have" also land.
- An item is a `- ` line whose first non-space character after the dash is `✅`, `⚠️` (with or
  without the variation selector U+FE0F) or `❌`. The requirement is often bold:
  `- ✅ **AI-native: orchestrate agents** — not "uses AI tools", but…`. Rule: if the text opens
  with `**…**`, that is the requirement and whatever follows the first ` — ` after it is the
  evidence; otherwise split at the first ` — ` (also accept ` - ` and `: ` as a fallback). No
  separator → the whole line is the requirement and the evidence is `''`.
- A continuation line (indented, no dash) belongs to the item above it.
- `### Gaps worth closing` → list items, markers stripped. `### Keywords for the ATS` → split on
  commas, strip a leading `True and missing:`-style lead-in (anything up to the first colon when
  that colon comes before the first comma), trim, drop empties and a trailing full stop.
- `### Projects to lead with` → `slug — line` rows; a slug must match `SLUG` from
  `content-schema.ts`'s pattern (copy the regex as a literal — this file imports nothing).
- **Every other `### ` section is kept, in order, in `extra`.** Real rows carry `### Resume`,
  `### Route in`, `### Note on …`. Dropping them would lose the owner's most useful paragraph.
- `recognised` is `true` when a verdict or a score *and* at least one item parsed. Otherwise the
  screen falls back to rendering the whole text as prose. Garbage, `''`, `null`-ish input and CRLF
  line endings must all return a well-formed object, never throw.
- Pure function of the whole string — it is called on every streamed delta, like `parseFields`.

### Channels (closed)

| key | label | limit | instruction template |
| --- | --- | --- | --- |
| `note` | LinkedIn note | 200 characters | `LinkedIn connection note to <first name>, <title>` |
| `message` | LinkedIn message | 600 characters | `LinkedIn message to <first name>, <title>` |
| `referral` | Referral ask | 600 characters | `LinkedIn message to <first name>, <title> — ask whether they would refer me for this role` |
| `email` | Email | 150 words | `Email to <first name>, <title>` |
| `followup` | Follow-up | 150 words | `Short follow-up email to <first name>, <title>; I applied on <date>` (offered only once `appliedOn` is set) |

The limits are the ones `jobOutreach`'s instructions already state; keep the two in agreement and
say so in a comment on both. `measure()` counts on the page — a model's own count is not trusted
(the existing comment in `[slug].astro` says why).

### `nextAction` — first rule that matches

1. No advert → "Paste the advert — everything else is read against it." → opens Edit details.
2. No fit → "See how you compare before spending time on it." → `assess`.
3. Verdict `Poor` and status `saved` → "This one scored Poor. Withdraw it, or keep it and say why
   in the notes." → Overview. (Information, not an automatic change.)
4. Status `saved`, no resume variant chosen → "Pick the resume you will send, or build one for
   this advert." → Resume tab.
5. Status `saved`, a contact exists with no kept draft → "You know someone here. Ask before you
   apply." → Outreach tab, `draft`.
6. Status `saved` → "Ready to apply. Mark it applied when you have." → `applied`.
7. `nextOn` is today or earlier → "Follow-up is due: <nextStep>." → Outreach tab.
8. Status `applied`, `appliedOn` seven or more days ago, no `nextOn` → "A week since you applied —
   send a follow-up." → Outreach tab.
9. Otherwise → "Nothing due." with no button.

`today` is a parameter (`YYYY-MM-DD`), never `new Date()` inside — that is what makes it testable.

### `peopleSearches`

Three or four plain strings the owner can paste into a search box themselves — e.g.
`<company> technical recruiter`, `<company> engineering manager <first two words of role>`,
`<company> talent acquisition`. Shown with a Copy button each when there are no contacts. **The
screen never runs one.**

## 6. The assistant

Two tasks, unchanged in name, surface and context. Two small edits in `src/lib/assist-tasks.ts`:

1. **`jobFit` gains one section**, after "Keywords for the ATS":

   ```
   ### Projects to lead with
   slug — one sentence saying why this project makes the case for this role
   ```
   with the rules: three to five, strongest first; the slug must be one from the index; read the
   project before writing its line; fewer than three if fewer genuinely fit. Change the closing
   rule to "nothing after the last project line". Raise `maxTokens` from 2500 to 3000.
   `needsCorpus` is already `true`, so the index is already in the prompt.
2. **`jobOutreach`** — no prompt change required. Confirm its three channel limits match
   `OUTREACH_CHANNELS`; add the cross-reference comment.

Mirror the new section in `.claude/skills/jobs/SKILL.md`'s fit template (between "Keywords for the
ATS" and "Resume") so a fit written from the editor and one written from the screen parse alike.

**After changing a prompt, run `npm run probe:ai`** if `OPENROUTER_API_KEY` is in `.env` (it is not
part of `npm run check`). If the key is absent, say so in the phase report rather than skipping
silently.

### How runs are started from the page

- **Assess fit** — as today: opens the panel and sends `/assess-fit`; the task is `live`, so the
  text streams into the fit textarea. New: the Fit tab re-renders from that textarea as it grows
  (on a `requestAnimationFrame`, with the `settled` guard `admin-surface.md` describes for the
  trailing-frame race). While streaming and not yet `recognised`, show the raw text in the pane.
- **Draft outreach from a card** — the page calls `runAssist('jobOutreach', context,
  outreachInstruction(contact, channel, appliedOn), handlers, signal)` **directly**, without going
  through the panel's composer, and streams into that card. One run at a time per page: a second
  click while one is running is refused with a toast, and the running card has a Stop button that
  aborts its controller. On completion, split on the `---` line into versions (the existing
  `versions` logic — move it, do not duplicate it).
- The panel stays for conversation and for typed commands; `/draft-outreach …` typed there behaves
  exactly as it does now.

## 7. The screen, piece by piece

### 7.1 What stays the value

The eleven inputs and the contacts textarea **stay in the DOM and stay the value**, so
`trackDirty`, `fill()`, `changes()` and Save are untouched in principle. They move:

- `company`, `role`, `url`, `jobDescription` → the **Edit details** dialog.
- `status`, `appliedOn`, `nextStep`, `nextOn`, `notes`, `resumeVariant` → the Overview rail and the
  Resume tab, as real controls (these are edited often; hiding them behind a dialog would be worse).
- `fit` → the Fit tab, behind an **Edit as text** toggle.
- `contacts` → a hidden textarea; the Outreach tab's Add / Edit / Remove contact write it.
- New: `outreach` → a hidden textarea, added to `inputs`; Keep / Edit / Remove draft write it.

Every write to a hidden holder is followed by `tracker.check()` and a repaint of the view that
reads it. **A view never holds state the holder does not** — paint from the holder, always.

### 7.2 Header (always visible)

- Title `Company — Role`; stamp `last saved … UTC`.
- A strip of chips: status (the existing select, `is-auto`), fit (`Reasonable · 6/10`, or
  `Not assessed`; click → Fit tab), resume (`AI-Native Full-Stack Builder` or `Master resume`;
  click → Resume tab), next (`<nextStep> · <nextOn>`; overdue is marked with text — "overdue" —
  not colour alone).
- Actions: Posting ↗ (only when http(s)), Assistant, a `<details>` overflow menu (**Edit details**,
  **Copy advert**, **Delete** — same two-click arm as now), Save.
- When dirty, an inline line beside Save names what is unsaved: "Unsaved: fit, outreach".
- **The Next strip** under it: `nextAction()`'s sentence and one button. Recomputed after every
  paint.

### 7.3 Overview

Two columns (`minmax(0, 2fr) minmax(280px, 1fr)`, one column under ~900px of *available* width —
size by the room the page has, since a docked assistant takes a column; keep the existing
`auto-fit` reasoning).

- **Advert** — the text in the body face at a reading measure, `white-space: pre-wrap`, built with
  `textContent`. Clamped to roughly 28 lines with **Show the whole advert**; **Copy** beside the
  heading. Empty → `.admin-empty` saying what fills it, with **Paste the advert**.
  No attempt to reformat the advert: it is stored verbatim on purpose.
- **Rail**, three cards:
  - *Where it stands* — status, applied on, next step, next on, resume sent (read-only line with
    "change" → Resume tab). Keep the existing "Applied with no date → today" behaviour.
  - *People* — each contact's name and title, a count of kept drafts, → Outreach tab. Empty →
    "No contacts yet" → Outreach tab.
  - *Fit at a glance* — verdict, score, and three counts (met / adjacent / missing) → Fit tab.
  - *Notes* — the notes textarea (`data-grow`), with an **Add dated line** button that inserts
    `YYYY-MM-DD — ` at the top and focuses it.

### 7.4 Fit

- **Banner**: verdict level and its sentence; score as `6/10` with its sentence. Level is text plus
  an icon; do not rely on colour.
- **Comparison** — the centrepiece. Two labelled columns: **The role asks for** | **Your record
  shows**. A sub-heading row per group (Must-haves, Nice-to-haves). Each row: a mark cell (icon +
  visually-hidden label "Met" / "Adjacent" / "Missing"), the requirement, the evidence. A missing
  item with no evidence reads "Nothing in the record." Real `<table>` with `<th scope>`; under
  ~640px each row stacks (requirement above evidence).
- **Filter**: All · Met · Adjacent · Missing, with counts, as `aria-pressed` buttons. Filtering
  hides rows; it never changes the text.
- **Inline markup in a cell**: evidence contains `` `code` `` and `**bold**`. Write one small
  function in the page (or reuse the element-building markdown pass in `AskWidget.astro` if it can
  be lifted into a module without dragging the widget along — inspect first) that turns those two
  into `<code>` / `<strong>` **elements with `textContent`**. Nothing else; no links.
- **Gaps worth closing** — a list; each item has Copy.
- **Keywords** — chips; clicking one copies it; **Copy all** copies them comma-separated.
- **Everything else it said** — each `extra` section under its own heading, rendered through
  `POST /api/preview` into a `.prose` node (one request for all sections joined, debounced and
  run-guarded like the journal preview; signed out or failed → show the markdown as pre-wrap text).
- **Actions**: **Assess fit** / **Re-assess** (confirm by a two-click arm when a fit exists — it
  overwrites; Undo is offered in the panel as today), **Copy assessment**, **Edit as text** (shows
  the textarea in place of the view; toggling back re-parses).
- `recognised === false` with text present → render the whole text through `/api/preview` with a
  note: "This assessment is not in the usual shape, so it is shown as written. Re-assess to get the
  comparison."
- Empty → `.admin-empty`: what an assessment is, what it reads (master resume + projects), and the
  **Assess fit** button. If there is no advert, the button is disabled with the reason.

### 7.5 Resume & projects

- **Resume to send** — the existing variant select. Under it, for the chosen variant (or the
  master): label, headline, summary (with Copy), and the projects it lists. Read these from the
  `resume` document already loaded on this page (`resolveVariant`), never from a second fetch.
- **Open in the Resume screen** — a link to `/admin/resume`. Inspect `resume.astro` for an existing
  way to open on a given variant; use it if there is one, otherwise a plain link is acceptable.
- **Build a variant from this advert** — the hand-off. The advert is private and must not travel in
  a URL. Put `{ slug, company, role, advert }` under a new key in `ADMIN_KEYS`
  (`resumeHandoff`) in **`sessionStorage`**, then `navigate('/admin/resume')`. On the Resume
  screen, if that key is present: show the existing restore-bar pattern — "Build a variant for
  Acme — Full-Stack Builder?" with **Build** and **Dismiss** — and on Build, create a new
  variant the way that screen already creates one, set its `jobDescription`, select it, and open
  the assistant with `/build-variant`. Clear the key on either answer. **Read how `resume.astro`
  creates and selects a variant before writing this; reuse its functions.** When the variant is
  saved, nothing writes back here automatically — the owner picks it in the select. Say that in
  the copy.
- **Projects to lead with** — from `parseFit().projects`. A card each: project title (looked up
  from the projects list — add `listProjects()` to `content-store.ts` beside `listApplications()`
  if there is no client-side reader yet; inspect first), the line with **Copy**, a link to the
  public page and to `/admin/projects/<slug>`, and two flags: *in this resume* (the chosen variant
  lists the slug) or *not in this resume*, and *hidden on the site* when the project is hidden. A
  slug that matches no project is shown as text with "no such project". Empty → "Re-assess to get a
  project shortlist" (older assessments predate the section).
- **Keywords the resume is missing** — the same chips as the Fit tab (one render function, two
  mounts).

### 7.6 Outreach

- **A card per contact**: name, title, **Profile ↗** when the URL is http(s), and an overflow with
  Edit and Remove (Remove is a two-click arm; it also removes that contact's kept drafts, and says
  so).
- **Add contact** — a small dialog: name (required), title, profile URL. Writes
  `formatContact()` into the contacts holder. The existing note stays, reworded for a button:
  "Only people you found yourself. Nothing here looks anyone up."
- **Per card, a row of channel buttons** from `OUTREACH_CHANNELS` (Follow-up only once applied).
  Clicking one runs the draft *in that card*: a status line with the stage ("Drafting…"), Stop, the
  text streaming, then the versions side by side (stacked when narrow). Each version: the text, a
  meter `187 / 200 characters` (over the limit → the word "over" and the count, not colour alone),
  **Copy**, **Keep**. Unkept versions are discarded when the page is left; say so once, in the
  card.
- **Kept drafts** in the card: channel label, meter, the text in an editable textarea
  (`data-grow`, the meter live as it is edited), **Copy**, **Mark sent**, **Remove**.
- **Mark sent** does three things to the form, none to the network: inserts
  `YYYY-MM-DD — <channel label> to <name> (sent)` at the top of Notes; if `nextStep` is empty, sets
  it to `Follow up with <first name>` and `nextOn` to seven days out; toasts "Noted — press Save".
- **No contacts** → `.admin-empty`: who is worth finding (the recruiter who posted it, the hiring
  manager, someone you have worked with), the `peopleSearches()` strings each with Copy, and **Add
  contact**.
- Blocked states, each with its reason on the button's `title` and in a line under the row: no
  advert; resume did not load; signed out.

### 7.7 Edit details dialog

`<dialog class="modal">`, three bands. Company, Role, Posting URL, Job description (the monospace
textarea, tall, scrolling inside the body band). Foot: **Done** (closes; the page repaints the
header and Overview from the inputs). It does not save — the page's Save does — and the foot says
"Changes are saved with the page's Save button." Escape and backdrop behave as the other modals.

### 7.8 Tabs and the URL

`wireTabs()`, with the tab in the hash (`#fit`, `#resume`, `#outreach`; Overview is no hash) so a
reload and a link land where they were — follow how `projects/[slug].astro` reads and writes
`#case-study`. The tab bar is the existing sticky `.tab-bar`. Chips and the Next button switch tabs
through the same `select()`.

### 7.9 States every piece must have

Loading (skeleton blocks in the shell, not a blank page — the row arrives over the network), signed
out (the existing `lock()` reason), row not found, resume failed to load, empty, streaming,
stopped, failed (reason in the line beside the control **and** a toast — both channels are
required), dirty, saved.

## 8. Files

| File | Change |
| --- | --- |
| `migrations/0017_application_outreach.sql` | new — one `ALTER TABLE` |
| `src/lib/content-schema.ts` | `outreach` in `APPLICATION_COLUMNS` |
| `src/lib/content-store.ts` | `outreach` in `ApplicationFields`; `listProjects()` if absent |
| `src/lib/job-view.ts` | new — section 5 |
| `src/lib/assist-tasks.ts` | `jobFit` section + ceiling; comment on `jobOutreach` |
| `src/lib/admin.ts` | `resumeHandoff` key |
| `src/pages/admin/jobs/[slug].astro` | the screen |
| `src/pages/admin/resume.astro` | receive the hand-off (phase 4 only) |
| `src/styles/admin.css` | `.jw-*` rules |
| `scripts/test-content-schema.mjs` | the `outreach` case |
| `scripts/test-cli.mjs` | `job-view.ts` fixtures (section 9) |
| `.claude/skills/jobs/SKILL.md` | fit template gains the section; `outreach` field documented |
| `.claude/rules/admin-surface.md` | the Jobs paragraph and the screen table's `jobs/[slug]` row |
| `CLAUDE.md` | `applications` bullet names `outreach`; `job-view.ts` in the `src/lib/` list |
| `docs/DECISIONS.md` | decision 83 — why derived-on-read, why one column, why the form became a dialog |
| `docs/FEATURES.md`, `CHANGELOG.md` | the usual |
| `src/pages/colophon.astro` | only if its hand-counted `FACTS` are changed by this (a column count) |

If `[slug].astro` passes ~900 lines, move the DOM builders into `src/lib/job-workspace.ts`
(browser-only, may import `admin.ts`, `clipboard.ts`, `job-view.ts`). Do not split further.

## 9. Tests and verification

### Automated — must be green before a phase is reported done

```bash
npm run check
```
```bash
npm run build
```

Add to `scripts/test-cli.mjs` (plain `node:assert`, same style as the `job-boards.ts` block):

- `parseFit` on a fixture in the **template** shape → verdict, score, counts per mark.
- `parseFit` on a fixture in the **real** shape: bold requirements, an em dash *inside* a bold
  requirement, `⚠️` with and without U+FE0F, a continuation line, a keywords line with a
  "True and missing:" lead-in, and three unknown `###` sections → every item lands, and `extra`
  holds the three sections in order with their text intact.
- `parseFit` on `''`, a paragraph of prose, and CRLF input → no throw; `recognised` false for the
  first two.
- `parseFit` fed one character at a time → never throws, and the item count never decreases.
- `parseContact` → name/title/url; a `javascript:` or relative URL yields `url: null`; a line with
  no separators is a name.
- `parseOutreach(formatOutreach(x))` round-trips; a draft body containing a line starting `## `
  inside it is the one known limit — pin whichever behaviour is chosen and say so in a comment.
- `measure` at the limit and one over, for a character channel and a word channel.
- `nextAction` — one assertion per rule in section 5, with `today` passed in.
- `job-view.ts` contains no `import` (assert on the source, as `check:edge` does for its module).

`check:ai` must stay green **without** editing its job-surface assertions.

### In the browser — the implementing agent does this, with evidence

`npm run db:migrate:local`, then `npm run dev` (port 4321 is fixed; a busy port is an error, not a
reason to use 4322). Use a local, made-up application row — **do not copy the live rows' contents
into fixtures, commits, screenshots or the report**; invent a company. Sign-in locally follows the
admin test harness already used in this repo.

Check, and screenshot each into the scratch area (not the repo):

1. Each tab with a full row; each tab with an empty row.
2. Both themes (Modernist, Blueprint) × light and dark.
3. 375px wide, 768px wide, and desktop with the assistant docked right *and* left — no horizontal
   scroll, no control under the panel.
4. Assess fit end to end: stream → comparison appears → Undo restores → Save → reload shows it.
5. Draft from a card: stream → two versions with meters → Keep → edit over the limit (meter says
   over) → Mark sent (note line, next step, date) → Save → reload shows the kept draft.
6. Stop mid-run on both kinds of run; nothing half-written is left marked as kept.
7. Keyboard only: tab order, the tablist's arrow keys, both dialogs open/close/Escape, focus
   returns to the opener.
8. Navigate away and back through the sidebar (the page script runs once per session —
   `onAdminPage` — so the second visit is the real test).
9. View source of `/admin/jobs/<slug>` signed out: no company name, no advert, no contact.
10. Console: no errors, no unhandled rejections.

## 10. Working agreement for the implementing agent

**Start state.** The working tree currently holds another feature's uncommitted work
(`feature/case-study-chapters`, including `migrations/0016_…`). **Do not start on top of it.**
Run `git status` and `git branch --show-current` first. If that branch is not yet merged to `main`,
stop and ask the owner whether to (a) wait, or (b) branch from it. Then work on
`feature/job-workspace`. Never commit to `main`, never push without being asked, never deploy,
never run `db:migrate` (remote) — the deploy workflow applies migrations.

**Do not touch live content.** No `portfolio` CLI writes, no MCP writes, no reads of
`~/.config/portfolio/cli.json`. This is a code change only.

**Phases — one at a time, stop after each.** Each phase is one commit (message describes the
change; no attribution lines).

| # | Phase | Done when |
| --- | --- | --- |
| 1 | Data and parsing: migration, schema, store, `job-view.ts`, all its tests | `npm run check` green; nothing on screen has changed |
| 2 | Shell and read views: header chips, Next strip, tabs, Overview, Fit (render only), Edit details dialog; `.jw-*` styles | The old form is gone; every old field is still editable and Save still sends only changed keys; browser checks 1–3, 7–10 |
| 3 | Outreach: contact cards, Add/Edit/Remove contact, in-card drafting, Keep, meters, Mark sent | Browser checks 5, 6 |
| 4 | Resume & projects: variant facts, project shortlist, keywords, hand-off to the Resume screen; `jobFit` prompt section; skill template | Browser check 4 and the hand-off both ways; `probe:ai` run or reported as not runnable |
| 5 | Docs: DECISIONS 83, FEATURES, CHANGELOG, CLAUDE.md, admin-surface.md | `npm run check` and `npm run build` green on the final tree |

**Report after each phase**, in this shape (it is `AGENTS.md`'s, and the reviewer reads it against
the diff):

- **Discovered** — what the code turned out to be where this plan guessed (it guesses in four
  places, each marked "inspect first").
- **Changed** — files, and anything done differently from this plan with the reason.
- **Verified** — the exact commands run and their result; which browser checks, with screenshot
  paths. "Not verified" is an acceptable entry; an unverified item described as done is not.
- **Risks / open questions.**
- **Next.**

**When this plan and the code disagree, the code and `docs/DECISIONS.md` win** — stop and report
rather than bending either. Do not refactor anything this plan does not name. Do not restyle a
global component class from the page. Do not add a feature this plan does not list; put the idea in
the report instead.

## 11. Deliberately not in this plan

- Sending anything, or opening a compose window with text prefilled.
- Fetching, scraping or previewing a posting or a profile.
- A kanban board, drag-and-drop pipeline or calendar on the manifest (`/admin/jobs`).
- Interview prep, salary notes, cover letters. Each is a task and a section; add them after this
  shape has been lived with.
- Autosave. One Save, as on every other screen.
- A structured `fit` (JSON). Markdown parsed on read keeps the CLI, MCP server and skill working
  unchanged; revisit only if the parser turns out to be fragile against real assessments.
