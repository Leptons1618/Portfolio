# Harness, explainers and the job desk: three workstreams

**Date:** 2026-11-11 · **Status:** planned, not started
**Decisions this will record:** 84 (harness), 85 (explainers), 86 (job desk)
**Who does what:** an implementing agent builds this phase by phase and reports per phase
(`AGENTS.md`: discovered / changed / verified). The planner judges the result against section 7.

Read first: `CLAUDE.md`, `.claude/rules/ai-assistant.md`, `.claude/rules/admin-surface.md`,
decisions 24, 25, 29, 60, 76, 78, 81, 82, 83 in `docs/DECISIONS.md`.

---

## 0. What was measured before writing this

| Fact | Where it came from |
| --- | --- |
| 16 of 16 public case studies have **0 inline images**, **0 architecture images**, **0 metric cards**, **0 chapters** | live HTML of every `/case-studies/<slug>`, counted |
| 7 of 7 sampled journal posts have **0 inline images** | live HTML |
| Sampled project pages (`bhashalens`, `otbench`, `localrag`, `daystorm`) have **no hero and no image at all** | live HTML |
| 13 of 30 projects have no case study, so their page is a summary, a highlight list and a stack list | `portfolio_list project` |
| `/draw-diagram` is `surface: 'journal'` only; the project screen has no diagram task | `assist-tasks.ts:651` |
| Nothing checks a model's answer except "did a label parse"; a bad answer is the owner's to notice | `assist.ts`, `assist-panel.ts` (salvage state) |
| `probe:ai` proves the wire works; nothing scores what a task *wrote* | `scripts/probe-ai.mjs` |
| The jobs manifest groups by status and shows next step; it shows no score and has no sort | `admin/jobs.astro:255-297` |
| All 7 applications are `saved`; the one read in full has a 6/10 fit, 2 contacts, `outreach: null` | `portfolio_get application` |

The headline: **the machinery for visuals exists** (Mermaid task, Excalidraw, `architecture_image`,
`metrics`, `paged`, the lightbox) **and no published page uses any of it.** The viewer complaint is
a content-production problem first and a layout problem second. Workstream B is built around that.

Not done: the admin screens were read as source, not looked at rendered. The implementing agent
must screenshot `/admin/jobs` and `/admin/jobs/<slug>` (local harness in the admin test memory, or
the dev server with a real session) before changing them, and again after.

---

## 1. The harness as H = (E, T, C, S, L, V)

Reading used here: **E** execution loop, **T** tool registry, **C** context manager, **S** state
store, **L** lifecycle hooks, **V** evaluation interface. If the owner means a different expansion,
only the headings change.

### 1.1 Where each component is today

| | Today | Gap |
| --- | --- | --- |
| **E** | `agentStream()` / `agentComplete()` in `ai.ts`: bounded rounds, total-call cap, tools withdrawn at the limit, run deadline, answer grace, two one-shot rescues (text tool call, deliberation-only). Long work is steps: `agent-runner.ts` (server, daily post) and `case-study-writer.ts` (browser, case study). | The loop ends when the model stops. **Nothing looks at the answer and sends it back once.** An unrecognised shape, an over-limit note or a broken diagram is a manual "Try again". |
| **T** | `ai-tools.ts`: five public read tools; `ai-code.ts`: three repo readers behind `needsRepo`. Closed schemas, read-only by name. `ToolOptions.only` narrows (Jev). | A task's tool set is `lookups?: 'repo'` or everything. `jobFit` is offered `read_post`; a diagram task cannot say "repo readers only". No per-tool tally (calls, ms, error, chars returned) in the run's log row — **verify in `RunSummary` before adding.** |
| **C** | Index instead of corpus, `CONTEXT_LIMITS` per field, history window of 12, `compactToolResults()`, panel compaction, `cache_control` breakpoints. | Nobody can see what a run *carried*. When a case study comes out generic, there is no record of whether the README was 300 chars or 6,000. |
| **S** | `documents` rows `run:journal-post:<day>` and `run:case-study:<slug>`, `ai_chats`/`ai_messages`, the `logs` table, the undo ring (browser, not persisted). | The owner's verdict on a run is thrown away. Undo, Try again and "saved unchanged" are the only quality labels this system will ever get for free, and none is recorded. |
| **L** | `onEnd(RunSummary)` in a `finally`; the daily `advance()` writes a step record. | One hook, at the end, for logging. No point at which a finished answer is validated *before* it is offered or stored. |
| **V** | `check:ai` (deterministic guards), `probe:ai` (wire test, prints thinking/answer split), `runReport()` (level + phrase per run). | **No evaluation of output quality at all.** A model swap is judged by reading a post. |

### 1.2 What to build

One new import-free module carries most of it. Do not build a hook framework, a plugin registry or
a second loop; every item below is data on the task spec plus one bounded extra round.

#### A1 — `src/lib/assist-validate.ts` (V, L)

Pure, imports nothing (same rule and same reason as `journal-auto.ts` and `job-view.ts`: `check:ai`
loads it in plain Node, and the browser bundles it).

```ts
export interface Finding { code: string; message: string; repairable: boolean }
export type Validator = (answer: string, ctx: ValidateContext) => Finding[];
export const VALIDATORS: Record<ValidatorName, Validator>;   // closed table
export function validate(names: readonly ValidatorName[], answer: string, ctx): Finding[];
export function repairInstruction(findings: Finding[]): string; // what the one repair turn says
```

`ValidateContext` is data the caller already holds: the task's shape keys, the index's slugs, a
channel limit, the advert text. Nothing is fetched.

Validators to ship (each one line of intent; write the fixtures first):

| Name | Fails when | Used by |
| --- | --- | --- |
| `shape` | `parseFields(text, shape).recognised === false`, or a required label is empty | every `document` task |
| `slugsExist` | a slug the answer cites is not in the index it was given | `jobFit`, `resumeProjects`, case-study tasks |
| `mermaidLint` | fence missing; first line is not a known diagram type; more than 12 nodes; unbalanced `[](){}`; a label containing a character the task's own instructions forbid | `diagram`, B's diagram tasks |
| `fitShape` | `parseFit(text).recognised === false`; a ✅ line with no evidence after the dash; score missing | `jobFit` |
| `fitScore` | the model's score differs from `scoreFromMarks()` (section 4.2) by more than 2 | `jobFit` — **not repairable**, reported as a note |
| `channelLimit` | a version exceeds `OUTREACH_CHANNELS[channel]` as counted by `measure()`; not exactly two versions; an email with no `Subject:` line | `jobOutreach` and its new siblings |
| `banned` | a phrase from the task's own "never write" list, or `!` | outreach tasks |
| `hasFigure` | a section over ~250 words with no image line, table, fence or list (a wall of prose) | `casestudysection`, `journalsection` |
| `truncated` | `stopReason === 'length'` | all (the daily job already refuses this; make it one rule) |

`ASSIST_TASKS[name].validators?: ValidatorName[]` is the lifecycle hook. Typed as a closed union so
a typo fails `astro check`, same as `AssistField`.

#### A2 — one repair round (E)

In `agentStream()` and `agentComplete()`: after the answer round, if the caller passed
`validate` and it returns a repairable finding, send **one** `user` turn built by
`repairInstruction()` through `answerCall()` (no tools), flag `repaired`, and stop whatever comes
back. Same shape as the existing `nudged` flag — once per run, counted against the same deadline,
never a third attempt.

- Streamed, live tasks: the first answer has already been written into a field. The repair's
  answer replaces it through the same `applyLive` path; the snapshot taken before the run is still
  the Undo target. The panel shows one line: `Repaired: <codes>`.
- Public chat: **no validators, no repair.** It is the surface that spends a stranger's budget.
- Daily job: `truncated` and `shape` findings on a step are a failed step, as today. Repair is not
  added there in this plan — a failed step is already the unit of retry (decision 76).
- `check:ai` pins: a stub that fails validation twice ends after one repair; a passing answer gets
  no extra round; the repair round carries no `tools` field; the deadline still bounds it.

#### A3 — tools as an allowlist per task (T)

Replace `lookups?: 'repo'` with `tools?: readonly ToolName[]` on the task spec (absent = today's
default for the surface). It is intersected inside `toolsFor()` exactly where `ToolOptions.only`
already is, so a task can only *narrow*. `casestudyplan` becomes the three repo readers by name.
`jobFit` becomes `search_content`, `read_project`, `read_case_study`, `read_resume`.

Add per-tool tallies to `RunSummary` (name, calls, ms, error count, result chars) if they are not
already there, and write them into the run's log row. No new tool is needed for workstream A.

`check:ai` pins: a task cannot name a tool its surface does not have; the allowlist cannot add
`needsRepo` tools without a token.

#### A4 — the context manifest (C)

`assistPrompt()` already assembles the parts. Have it also return
`{ part: 'system' | 'index' | 'context:<field>' | 'history' | 'steer', chars, capped }[]`, and:

- write it into the run's log row (numbers only — never the text);
- send it as one `{"context":[…]}` frame on the **assist** surface only (`forPublic()` drops it;
  add it to the leak list `check:ai` pins);
- show it in the panel's run footer as one line, expandable: `README 6,000 (capped) · advert 3,812 · index 2,140`.

That is the whole feature. No token counting, no budget optimiser.

#### A5 — the owner's verdict as state (S)

Three events already happen in the browser; record each as one `record()` row with source
`assist-feedback` through the existing owner-only log path (`reportFault`'s sibling in
`log-store.ts`; add `reportFeedback(task, model, outcome)`), bounded like `reportFault`:

- `undone` — Undo pressed on a run's snapshot
- `retried` — Try again
- `kept` — the screen saved while the run's output was still in the field, unchanged or edited
  (`kept` / `kept-edited`; compare by value, the way `dropUnusedSnapshot()` does)

No text is stored: task, model, effort, outcome, the validators' codes. This stays inside decision
62 (owner-authenticated, bounded) — confirm against `log.ts`'s header before adding the call.

`/admin/logs` gets nothing new; the source filter already exists. A4 + A5 + the tallies give the
per-model table in A6 its denominators.

#### A6 — `npm run eval:ai` (V)

`scripts/eval-ai.mjs`, the third member of the `check:ai` / `probe:ai` family. **Not in
`npm run check`** — it needs `OPENROUTER_API_KEY` and costs cents.

- Fixtures in `scripts/eval-fixtures/`: two READMEs from the owner's public repos, two adverts
  (invented companies — never a real application row), one draft post. Checked in.
- For each fixture × task (`project`, `casestudyplan`, `casestudysection`, `diagram`, `jobFit`,
  `jobOutreach`, `compose`) and each `--model`: run `agentComplete()` with the task's real prompt,
  then `validate()`.
- Output: a table to stdout and `eval-<date>.json` in a path given by `--out` (default: not
  written). Columns: validators passed/failed by code, repaired?, answer chars, thinking chars,
  rounds, tool calls, ms, usage.
- **No model-graded rubric in this phase.** Deterministic checks first; a judge model is a second
  provider's opinion with its own failure rate, and nothing here needs it yet.
  `ponytail:` add an LLM judge only when two models tie on every deterministic column and the
  owner still prefers one.

`check:ai` gains the offline half: every validator against a passing and a failing fixture, and
that `repairInstruction()` names each failing code.

### 1.3 What not to do

- Do not merge `agent-runner.ts` and `case-study-writer.ts`. One runs under a cron lock with no
  stream, the other streams in a browser with an owner watching. They share the pure half
  (`agent-runs.ts`) already.
- Do not split `ai.ts` (2,966 lines) as part of this. It is a real smell and a separate change.
- Do not give any tool a write. Decision 24 and 37 stand.
- Do not add memory of "the owner's style" as a new document. `persona` in the settings row exists.

---

## 2. Explainers: projects, case studies and posts a stranger can follow

### 2.1 The diagnosis

A reader who lands on `/projects/daystorm` gets a title, one sentence, a changelog-style highlight
list and a list of library names. There is no picture of the system, no "what does this do, in
order", no screenshot. The case study adds 1,270 words and still no picture. The page chrome is
fine; **the page has nothing to show.**

Two fixes, and both are needed:

1. A **structured explainer** every project has, that renders as a visual with no image upload —
   so the 13 projects with no case study are covered too.
2. A **production path** that makes diagrams the default output of the writing tasks, and a
   backfill of the existing 16 studies.

### 2.2 Schema: one migration, three list columns on `projects`

`migrations/0018_project_explainer.sql` (0017 is the latest today — recheck before creating):

| Column | Shape | Renders as |
| --- | --- | --- |
| `plain` | TEXT, nullable | "In plain words" — two or three sentences a non-engineer follows. Not the summary restated. |
| `flow` | TEXT JSON list, default `'[]'` | "How it works" — each entry `"Step name \| what happens here"`, 3 to 7 entries. The same `"a \| b"` convention `metrics` and `links` use, read by a new `flowOf()` beside `metricsOf()` in `chapters.ts`. |
| `gallery` | TEXT JSON list, default `'[]'` | Screens — each entry `"/media/… \| caption"`. Only `/media/` paths render; anything else is dropped, the same rule `linksOf()` applies to hrefs. |

Follow the full widening checklist: `content-schema.ts` (columns + encoders), `content.ts`
(`ProjectData`), `content-store.ts`, `PROJECT_KEYS` if the assistant may write it (yes for `plain`
and `flow`; **no** for `gallery` — it is uploads), the CLI needs nothing (it has no field table),
`check:schema` cases, `SKILL.md` for the `portfolio` skill.

`flow` is the important one. It is a diagram that is **data**: it renders in theme tokens, works
in dark mode and print, needs no Mermaid, and can be drafted from a README.

### 2.3 Public rendering

All CSS, no new script, no renderer on a public page (decision 25 stands). Tokens only; check the
`@media screen` and spacing-scale rules in `CLAUDE.md` before writing a breakpoint.

**`src/components/FlowStrip.astro`** — an `<ol>` of numbered nodes joined by a rule and an arrow
drawn from gradients/borders (not a data-URI SVG — it cannot read a custom property). Horizontal
at desktop width, vertical below the breakpoint. Each node: index, step name, one line of detail.
Accessible as an ordered list; the arrows are `aria-hidden`.

**`/projects/[slug]`** — new order under the head:

1. `plain` as a lead paragraph (falls back to nothing; do not duplicate the summary)
2. **How it works** — `FlowStrip` from `flow`; when the linked study has an `architectureImage`,
   show it under the strip in a `data-zoom` figure
3. **Screens** — `gallery`, two-up grid, `Lightbox` (already a component), captions as
   `<figcaption>`
4. Highlights, Built with, Case study card, Related — as today

Renumber the `detail-num` counters from a list the way `CaseStudyLayout` does (`sections` /
`num()`), instead of the current hand arithmetic.

**`CaseStudyLayout`** — move the Architecture section **above** the write-up (after Problem /
Solution), and render the project's `FlowStrip` there too (pass `flow` as a prop from
`[slug].astro`; the layout still queries nothing). A reader should see the system before reading
1,000 words about it.

**`ProjectCard`** — nothing. A card is not where the explanation goes.

**`.prose` (case studies and posts)** — three additions in `global.css`, each small:

- an image followed by an italic line (`![alt](src)` then `*caption*`) renders as figure +
  caption. Check what `markdown.ts` emits first; if a rehype step is needed it goes there, **after**
  the sanitising walk's rules are understood, and `check:markdown` gets a case.
- blockquotes that open with a bold word (`> **Note** …`, `> **Result** …`) get a callout
  treatment by CSS alone (`.prose blockquote:has(> p > strong:first-child)`).
- tables get a scroll wrapper treatment and tabular numerals if they do not have them.

**Journal post page** — add a contents rail built from the post's `<h2 id>`s on read. `chapters.ts`
already cuts on `<h2 id>`; reuse `splitChapters()` for the titles rather than writing a second
heading parser. Posts with fewer than three headings show none. The 4fr/8fr split the page already
has gives it the column.

### 2.4 The production path (this is the part that fixes the complaint)

**B-task 1 — `projectExplainer`** (`surface: 'project'`, command `/explain-project`,
`tools:` the three repo readers, `live: 'project'`). Writes `PLAIN:` and `FLOW:` through
`PROJECT_KEYS`. Instructions: explain to someone who has never seen the repo; each flow step is
something the system *does*, in order, named in the user's terms not the library's; 3 to 7 steps;
nothing that is not in the README or the tree. Validators: `shape`, plus a `flowShape` (3–7
entries, each with a `|`, each side non-empty and under a length).

**B-task 2 — `projectDiagram`** (`surface: 'project'`, command `/draw-architecture`). The existing
`diagram` task's instructions with the project's context (`readme`, the case study's problem and
solution, `flow`) and the repo readers. Output is one Mermaid fence. The project screen routes it
through `diagram.ts` exactly as the journal editor does today; **Insert** offers two targets:
*as the architecture image* (fills the field) or *at the caret in the write-up*. Validators:
`mermaidLint`. The real parse is Mermaid's own, in the browser: when `renderMermaid()` throws,
the page runs the task once more with the parser's message as the steer (one retry, same rule as
A2), then shows the source with Copy.

**B-task 3 — figures in the long case study.** `casestudyplan` already plans sections. Extend
`parsePlan()` so each section may carry `figure: flowchart | sequence | state | table | none` and
one line saying what it shows. `casestudysection` is told its figure and writes it inline (a
Mermaid fence or a markdown table). `case-study-writer.ts` then, per finished section, renders any
fence through `diagram.ts`, uploads it (`images/diagrams/…`), and replaces the fence with the
image line + caption — the same Insert the journal does by hand. A fence that fails to render
after one retry stays in the body as a code block and is listed in the run's summary; it never
fails the section. `hasFigure` runs per section.

Do the same for `journalplan` / `journalsection` **only on the owner-driven path** (the Journal
screen's Run now loop, which runs in a browser). The cron tick has no DOM and cannot render
Mermaid; there, a section may carry a markdown table but not a diagram. Say so in the task's
instructions for the cron variant rather than emitting fences nothing will render.

**B-task 4 — prompt changes to the existing writers** (`casestudy`, `casestudybody`, `compose`):
add the same three rules. (1) Open each section with one sentence a newcomer can follow before
any mechanism. (2) Prefer a table for any comparison of three or more things. (3) Name what the
author *did* and *decided* — the reader wants the work, not a tour of the libraries. Keep each
task's token ceiling; this is instruction, not length.

**Admin, project screen** — a "Reader's view" checklist beside the existing completeness checklist
in `frontmatter-editor.ts` (same mechanism, no new one): plain words ✓, flow ✓ (n steps),
architecture image ✓, at least one figure in the write-up ✓, at least one screen ✓, key numbers ✓.
Each unchecked line is a button that runs the task that fills it, or focuses the field when no
task may (metrics and gallery are the owner's).

**Admin, manifest** — one small mark per card: `visuals 2/5`. It is the backlog.

### 2.5 The backfill

Content, not code, and it writes to the live site — so it is gated.

1. Pilot on three studies with public repos and real substance: `daystorm`, `ingesta`,
   `sia-proto`. For each: run `/explain-project`, `/draw-architecture`, and add two inline figures
   to the write-up. **Check every claim against the repo README** — several case studies here were
   fabricated rather than thin (see the project memory), and a diagram of an architecture that
   does not exist is worse than no diagram.
2. Do the pilot against **local D1** (`npm run db:migrate:local`, dev server). Screenshot the
   three project pages and three case-study pages, light and dark, desktop and mobile.
3. Stop. The owner approves the pilot before anything is written to production.
4. Then the remaining 13 studies and the 13 study-less projects (`plain` + `flow` only), through
   the admin screen or the `portfolio` CLI — never direct SQL. A study that does not match its
   repo is reported, not illustrated.

**Not the agent's to write:** `metrics` (decision 81 — the owner types the numbers) and `gallery`
(real screenshots). Deliver a list instead: per project, which numbers and which screens would
carry it, as questions for the owner.

### 2.6 Out of scope

Interactive demos, client-side Mermaid on public pages, video, a "projects compared" page, a
redesign of the card grid, changing the theme system.

---

## 3. The job desk

Decision 83 made the application screen a workspace. What is still missing is the **desk** — the
view across applications — and the last third of the flow: scoring you can trust at a glance, and
messages that go from draft to sent to followed up.

### 3.1 Manifest (`/admin/jobs`)

`listApplications()` already returns whole rows; `parseFit()` is import-free. No new endpoint.

- **Score and verdict on every row.** A chip: `6/10 · Reasonable`, coloured by verdict level via
  tokens. `—` when not assessed, and that row's primary action is *Assess*.
- **Sort:** by status (today's grouping), by score, by next date, by last updated. One
  `select.input`; remembered in `localStorage` under a key in `ADMIN_KEYS`.
- **Due strip above the list:** rows whose `nextOn` is today or past, and applied rows with no
  reply after N days — `nextAction(fields, today)` already computes the sentence; show it with the
  row's button. This is the screen's answer to "what do I do this morning".
- **Pipeline counts:** one line of status counts as filter chips (click to filter). Not a chart.
- **Dealbreaker mark:** a row whose fit has a ❌ must-have shows the count (`2 missing`). It is
  the fastest triage signal on the page.

### 3.2 Fit tab: a score you can read and check

- **`scoreFromMarks(view: FitView): number`** in `job-view.ts`, pure, pinned by `check:cli`.
  Must-haves weigh 3, nice-to-haves 1; met = 1, adjacent = 0.5, missing = 0; scaled to 10 and
  rounded to a half. Show it beside the model's score: `Model 6 · By the marks 6.5`. When they
  differ by more than 2, a note says which requirements are pulling it. (This is also validator
  `fitScore`.)
- **Breakdown bars:** two stacked bars, must and nice, met / adjacent / missing by count. Plain
  `<div>`s sized by `flex-grow`, token colours, a text equivalent for screen readers.
- **Missing must-haves first**, as their own block above the table, each with the matching "gap
  worth closing" when one names it.
- **Evidence links:** a project slug in an evidence cell that is in the loaded project list
  becomes a link to `/admin/projects/<slug>`. Built with `createElement`; no HTML from the model.
- **Role at a glance:** extend the `jobFit` shape with one optional leading section:

  ```
  ### Role at a glance
  Location: … · Mode: on-site | hybrid | remote · Level: … · Years: … · Pay: … · Posted: …
  ```

  `parseFit()` reads it into `facts: Record<string,string>` (unknown keys kept as text, absent
  section = `{}` so every existing assessment still parses). Chips at the top of Overview.
  Instruction: write `not stated` rather than guess.
- **Stale assessment:** when the advert textarea has changed since load and the fit has not, the
  Fit tab's banner says "The advert changed — re-assess". Page state only; nothing stored.
- **Keywords in the advert:** the Overview's advert reader marks each ATS keyword from the fit
  where it occurs (`<mark>` built from text nodes by splitting on the terms — never `innerHTML`).

### 3.3 Outreach: from a draft to a sent message with a follow-up

- **A composer on each contact card instead of a free-text steer.** Channel (the three in
  `OUTREACH_CHANNELS`), ask (process / team's problem / referral / fifteen minutes — the three
  the task already names, plus the fourth), tone (direct / warm), and an optional line of the
  owner's own. `outreachInstruction()` already builds the steer from contact + channel; extend its
  signature, keep it pure, extend its test.
- **New tasks, each a closed entry** (`surface: 'job'`, validators `channelLimit` + `banned`):
  - `jobFollowUp` (`/draft-follow-up`) — given the kept draft that was sent, the days since, and
    the contact: a shorter second message that adds one new thing and does not repeat the first.
    Context: `resume`, `jobDescription`, `fit`, `contacts`, and a new capped field `sentDraft`.
  - `jobCover` (`/draft-cover-email`) — the application email or cover note: `Subject:`, under
    220 words, three paragraphs — why this role, the two strongest ✅ with their evidence, the ask.
    Never leans on a ❌.
  - `jobReply` (`/draft-reply`) — the owner pastes what the recruiter wrote (new capped field
    `received`); output is two versions of a reply. Useful the first time anyone answers.
  Each new context field goes in the `AssistField` union, `CONTEXT_LIMITS` and `CONTEXT_LABELS`
  (the typecheck and `check:ai` enforce it).
- **Sent state on a kept draft.** The stored heading grows one optional part:
  `## Contact · Channel · sent 2026-11-12`. `parseOutreach()` / `formatOutreach()` own it;
  a heading without the part parses exactly as today (pin both directions in `check:cli`).
  "Mark sent" on a card stamps today, and **offers** — never silently sets — `status: applied`
  when it was the cover email, and `nextOn` = sent + 5 working days with `nextStep` "Follow up
  with <first name>". `nextAction()` gains the rule that a sent draft past its date with no later
  draft says "Follow up with …" and its button runs `jobFollowUp`.
- **Hand-off buttons, all owner-clicked, nothing sent by the site:** Copy (exists), **Open in
  mail** for an email draft when the contact line carries an address the owner typed — a plain
  `mailto:` anchor with subject and body `encodeURIComponent`-ed — and **Open profile** (exists).
  Decision 83's rule is unchanged: no fetch, embed or preview touches LinkedIn or a mail server.
- **Over-limit drafts repair themselves once** (A2), and a version still over the limit is shown
  with its count in the error colour and Keep disabled.
- **A thread per contact:** kept drafts under a contact render oldest first with their sent date,
  so the card reads as the conversation so far.

### 3.4 Out of scope

Sending anything, scraping LinkedIn or any profile, a comparison matrix across applications,
interview-prep tasks, salary research, anything public. `ai-corpus.ts` still has no input for
`applications`; add a `check:ai` assertion if one does not already exist.

---

## 4. Order of work

Each phase is its own commit series and ends green on `npm run check` and `npm run build`.

| # | Phase | Depends on | Size |
| --- | --- | --- | --- |
| 1 | A1 validators + A2 repair round + `check:ai` cases | — | M |
| 2 | A3 tool allowlists, A4 context manifest, per-tool tallies | 1 | S |
| 3 | B schema + `FlowStrip` + project page + case-study reorder + `.prose` additions + post contents rail | — | M |
| 4 | B tasks 1–4, reader's-view checklist, manifest mark | 1, 3 | L |
| 5 | B pilot backfill on local D1 → **owner approval gate** | 4 | M |
| 6 | C manifest + Fit tab (`scoreFromMarks`, bars, facts, keywords) | 1 | M |
| 7 | C outreach (composer, three tasks, sent state, follow-up rule, mailto) | 1, 6 | L |
| 8 | A5 feedback rows, A6 `eval:ai` + fixtures | 1, 4, 7 | M |
| 9 | Docs: decisions 84–86, `FEATURES.md`, `CHANGELOG.md`, `CLAUDE.md` module list, both `.claude/rules` files, `AI-ARCHITECTURE.md`, the two skills | all | S |
| 10 | Full backfill, after approval | 5 | M |

Branching: `feature/job-workspace` is unmerged and has an unrelated modified file
(`.commandcode/taste/taste/taste.md` — leave it alone). Phases 6–7 build on that branch's screen,
so either land it first or branch from it. Suggested: three PRs — harness (1, 2, 8), explainers
(3, 4, 5), job desk (6, 7) — with docs split across them.

---

## 5. Verification the implementing agent owes

Per phase, state what was run and paste the tail of the output. "It should work" is not a result.

- `npm run check` and `npm run build` — every phase.
- `npm run check:ai` — new cases for: each validator pass/fail, one repair then stop, repair round
  has no tools, allowlist only narrows, `context` frame dropped by `forPublic()`, new context
  fields capped, new tasks have a surface/command/validators and round-trip their shapes.
- `npm run check:cli` — `scoreFromMarks`, `parseFit` with and without *Role at a glance*,
  `parseOutreach`/`formatOutreach` with and without `sent`, the extended `outreachInstruction`,
  the new `nextAction` rule with `today` passed in.
- `npm run check:schema` — the three new columns: accepted, encoded, unknown sibling refused.
- `npm run check:markdown` — figure/caption output if a rehype step was added; raw HTML in a
  caption still escaped.
- `npm run check:content` — still passes (no static import of `drawing.ts`, `prerender = false`
  on anything new that reads D1, no unscoped `max-width` breakpoint).
- `npm run probe:ai` after touching `ai.ts` / `ai-tools.ts`; `npm run eval:ai` once in phase 8,
  table pasted into the report.
- **In a browser, with screenshots** (light and dark, 1440 and 390 wide): a project page with a
  flow and with an empty flow; a case study with and without an architecture image; a post with
  and without a contents rail; print preview of one case study; `/admin/jobs` sorted by score;
  the Fit tab on the Razorpay row; an outreach card through draft → keep → mark sent → follow-up.
- A public page's only script is still the chat widget (plus `code-fx`) — check the built output.
- Empty states: every new block renders nothing, not an empty box, when its data is absent.

---

## 6. Open decisions, with the default the agent should take

| Question | Default |
| --- | --- |
| Is H = (E, T, C, S, L, V) the expansion used in section 1? | Yes; only headings change otherwise. |
| May the assistant write `plain` and `flow`? | Yes, into the form; Save is still the owner's. |
| May the agent write the backfill to production? | **No** — local D1 pilot, then wait for approval. |
| Does the cron daily post get diagrams? | No. Tables only; diagrams on the owner-driven run. |
| A judge model in `eval:ai`? | No, deterministic only. |
| `mailto:` links on outreach cards? | Yes — an anchor the owner clicks is not the site sending. |

---

## 7. How this will be judged

1. **The stranger test.** Open three project pages cold. Within thirty seconds, without scrolling
   past the first screen and a half: what it does, how it works in order, what the owner built.
   A page that still needs the case study to answer those fails.
2. **Every published case study has an architecture figure and at least two inline figures**, and
   each one matches the repo. Zero fabricated architecture.
3. **A bad answer is caught by the harness, not by the owner**: demonstrate an over-limit
   connection note and an unrecognised document answer each being repaired once, and a third
   failure being reported rather than looped.
4. **`eval:ai` prints a table** that would let the owner pick between two models without reading
   their output.
5. **The jobs manifest answers "what do I do this morning"** in one glance, and a message can be
   taken from draft to sent to follow-up without leaving the card.
6. Nothing weakened: no tool writes, no new write endpoint, no application data in public HTML or
   the corpus, no renderer on a public page, no unscoped print breakpoint, every guard in
   `check:*` still green and none deleted.
7. The diff is the size the work needs. No hook framework, no registry, no `ai.ts` reshuffle.
