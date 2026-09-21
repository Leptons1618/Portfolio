# Agent runs — the daily post as resumable steps, and the veil that hid two dialogs

**Date:** 2026-09-21 · **Status:** approved, implementing · **Branch:** `fix/assist-long-runs`

## Context

Decision 64 shipped this morning (PR #21, deployed 09:20 UTC). By the
afternoon, three things were still wrong, and the production `logs` table
(read with `wrangler d1 execute --remote`) says exactly what:

1. **The veil covers the dialogs it was meant to sit under.** With the
   import form stepped down and the assistant docked, the form, the panel,
   the page and the rail all render at the same dimmed grey; only the toast
   is bright. Pixel-checked on the owner's capture: form background
   `(141,142,146)`, page background the same. `theme.css` sets
   `body > * { position: relative; z-index: 1 }` so that everything sits
   above the grain layer — which makes `.admin-shell` a stacking context at
   z 1, and the veil `body[data-asx-freeze]::after` at z 64 paints over the
   whole of it, the stepped-down dialog (65) and the panel (70) included.
   The `z-index` on those two is compared *inside* the shell, never against
   the veil. The previous session's browser check measured the veil's own
   z-index and not what it painted over.
2. **The daily job still fails, and one request is why.** Two rows since the
   deploy:
   - `09:33 forced · 240 s · 504` — `nvidia/nemotron-3.5-lightning:free`
     sent no headers inside the 180 s attempt; the next model got the 60 s
     the run had left; "did not answer in time. No time left in this
     request to try another."
   - `11:14 cron · 471 s · 504` — headers came early, `response.json()` is
     unbounded, and the body arrived after roughly 460 s carrying reasoning
     and no answer. `retryFor()` then tried the one-model row again with
     reasoning off — against a deadline that had expired 230 s earlier —
     and `callChat()` refused to start: "Every configured provider refused.
     No time left in this request to try another."

   Meanwhile every interactive run the owner made on
   `nvidia/nemotron-3-ultra-550b-a55b:free` at `low` answered: fifteen rows,
   25–150 s each, a `casestudyplan` with one lookup at 150 s, seven
   `casestudysection` steps at 12–90 s. The long case study is written as
   a plan and then one request per section (decision 60), and it works on
   the same free pool that the one-request daily post cannot survive.
3. **Nothing shows the owner what the daily run is doing.** *Run now* is a
   button and a pending toast; the thinking, the lookups and the failures
   are invisible until the log row lands. The owner asked for the run to
   open the assistant panel and show its work, and for the harness to stop
   spending its budget on deliberation: steps that decide and look up,
   compressed context between them, and a run that continues where it left
   off rather than starting over.

## Goals

- Two coexisting dialogs are bright over a dimmed, inert page. The
  stepped-down form is centred in the column between the rail and the
  panel.
- The daily post is a **run** — persisted state advanced one bounded
  **step** at a time: plan, one request per section, then assembly. A tick
  that runs out of time answers `in-progress` and the next tick continues.
  A failed step is retried by the next tick, bounded by the existing
  `maxAttempts`. A finished step is never redone.
- *Run now* opens the assistant panel on the Journal screen and drives the
  same run one streamed step at a time — thinking, tool rows, the section
  text arriving — with Stop keeping what finished and Resume carrying on.
- The tool loop stops paying for the same deliberation twice: a vendor's
  reasoning is handed back on the assistant turn that carries the tool
  calls, and earlier rounds' tool results are trimmed before the next round
  is sent.
- A non-streamed answer is bounded from the request to the last byte of the
  body, not to the headers.

## Non-goals

- Repository reads for the cron tick. They need the owner's token
  (`needsRepo`, decision 57) and a cron tick has none; a stored PAT is a new
  secret and a separate decision.
- A polish pass over the assembled post. The section step already carries
  the end of the previous section; if seams show, that is the next spec.
- Streaming the cron tick. Decision 61 stands: ten milliseconds of CPU per
  invocation, and waiting on a vendor is free.
- Moving `RUN_BUDGET_MS` or `ANSWER_GRACE_MS` for the interactive routes.
- Changing what `/api/ai/assist` can be asked to do. The two new tasks are
  `step: true` entries, on no menu and outside the request router, exactly
  like `casestudyplan` and `casestudysection`.

---

## A. The veil is drawn from inside the shell

`admin.css`: `body[data-asx-freeze]::after` becomes
`body[data-asx-freeze] .admin-shell::after`, same box (`position: fixed;
inset: 0; z-index: 64`), same colour. It is now in the same stacking context
as the rail (40), the route progress (60), a stepped-down dialog (65) and
the panel (70), so the dialogs paint over it and the rail under it. Nothing
changes in `modal.ts`: `syncFreeze()` still sets the marker on `<body>`.

The comment on the rule, and decision 59's amendment, say why the veil is
on the shell and not on `<body>`: `body > *` is a stacking context.

**Centred in the room the page has left.** The stepped-down dialog rule
already keeps `right: var(--asx-dock-w)` when the panel is docked right;
above 860 px it also gets `left: var(--admin-sidebar-w, 260px)` (and the
collapsed rail's 64 px under `:root[data-admin-collapsed]`) so the form is
centred between the rail and the panel rather than between the viewport
edge and the panel. Docked left, the mirror. Below 860 px the rail is a
banner and nothing changes.

**The panel's tool rows must not widen the log.** The capture shows a
horizontal scrollbar under the transcript: `.asx-tool-row` is a flex row
whose `.asx-tool-state` (the detail — `SKILL.md (15kb) · 483 ms`) is
`flex: none`, so a long detail pushes the row past the log. The state gets
`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space:
nowrap; max-width: 50%`, and `.asx-msg` gets `min-width: 0`.

Verified in headless Edge by sampling the dialog's background *pixel* under
the freeze, not by reading a computed `z-index`.

---

## B. `ai.ts` — three changes to the loop

### B1. Reasoning is handed back on the tool-call turn

`ChatMessage` gains two optional fields, `assistant` only:

```ts
/** OpenRouter's `reasoning_details`, verbatim, when the answer carried them. */
reasoning_details?: unknown[];
/** DeepSeek-style `reasoning_content`, when the answer carried it. */
reasoning_content?: string;
```

Both loops push them on the assistant message that replays the tool calls
(`messages.push({ role: 'assistant', content: said, tool_calls, …reasoning
})`), and **only when the round's response carried them** — a vendor that
sent the field accepts it back; a strict vendor that never sent it is never
sent it. `wireMessages()` passes them through untouched. `sseEvents()`
accumulates `delta.reasoning_details` (concatenating `text` per `index`,
copying any other entry whole) and `delta.reasoning_content`; the `tools`
event carries them beside `calls`. `agentComplete` reads
`message.reasoning_details` / `message.reasoning_content` off the body.

Why: OpenRouter's interleaved-thinking contract is "pass `reasoning_details`
back unmodified"; DeepSeek's is `reasoning_content` on the assistant turn.
Without it a reasoning model re-deliberates the whole task every round —
row 8 of the log paid 1,566 characters of thinking for three lookups and
2,450 tokens of answer; the daily run's plan step has a lookup round and
an answer round and should think once.

Nothing here is a new request field at the top level; `check:ai` pins that
a run whose responses carried no reasoning fields sends none back.

### B2. Earlier rounds' tool results are trimmed before the next round

`compactResults(messages, keep = 1): ChatMessage[]` — exported, pure. Every
`tool` message except those of the last `keep` assistant turns is cut to
`TRIM_CHARS` (600) characters plus `\n[trimmed: already read]`. Both loops
call it on the message list they send to `nextRound()` / `callChat()`. The
first round's results are read in full on the round that asked for them;
by the round after, the model has what it needed from them in its own
reasoning and its tool-call choices. Today every round re-sends every result
in full — three reads at 8,000 characters is 24,000 characters on every
later round, on a task whose whole ceiling is 4,000 tokens.

`check:ai`: a three-round stub asserts the third request body carries the
first round's result trimmed and the second's whole; a one-round run is
unchanged.

### B3. A non-streamed body read is bounded

For a `stream: false` call, `callProvider()` reads the body itself under
the same timer it already runs for the headers — `await response.text()`
before the `finally` clears it — and hands back a `Response` over the
buffered text with the original status and headers. An attempt that
exceeds `timeoutMs` end to end is an `AbortError` and walks on, exactly
like one that never sent headers; `callChat()` and `agentComplete()` read
the buffered response as they do today. The 460-second body in row `11:14`
becomes a 120-second failure on the step, and the run's next tick retries
the step.

With the body bounded, `agentComplete()` stops stripping the deadline from
the answer round: the deadline only ever decides whether an attempt may
*start*, and the attempt timer is what bounds a body. A step therefore has
one clock for its lookups and its answer alike (section D).

`check:ai`: a stub that sends headers at once and a body after the timeout
fails the attempt; one whose body arrives inside it does not.

---

## C. A run, and its steps — `src/lib/agent-runs.ts`

Pure, and it imports only `assist-tasks.ts` (its parsers and prompt
context builders) and `journal-auto.ts` (the voice rules and slugify). No
I/O, no secret, loadable by `check:ai` and by the browser.

### The state

```ts
export interface PostRun {
  kind: 'journal-post';
  key: string;                 // the UTC day, YYYY-MM-DD
  phase: 'plan' | 'write' | 'finish' | 'done' | 'failed' | 'declined';
  topic: string;               // topicFor(day, settings), or ''
  plan: PostPlan | null;
  sections: string[];          // finished, cleaned, in order
  failures: number;            // failed steps so far today
  trail: StepRecord[];         // one per step attempted, capped at 40
  slug?: string;               // set by finish
  error?: string;              // the last step's failure, for the screen
  lock?: { by: 'cron' | 'owner'; at: string };
  startedAt: string;
  updatedAt: string;
}

export interface PostPlan {
  title: string; summary: string; tags: string[];
  angle: string;               // the model's own one-line decision
  facts: string[];
  sections: PlannedSection[];  // 3–6
}

export interface StepRecord {
  step: string;                // 'plan' | 'section:2' | 'finish'
  label: string;               // 'Section 2 of 4: What broke first'
  ok: boolean;
  ms: number;
  model: string;               // label · model, or '' for finish
  note?: string;               // the failure, or the plan's angle
  at: string;
}
```

`clampRun(raw)` re-derives every field from whatever the JSON column holds,
the way `clampAutoRun()` does; a corrupt row is a fresh run, not a 500.

### The steps

`nextStep(run, settings): RunStep | null` returns the step to take now:

| phase | step | task | tools | context |
| --- | --- | --- | --- | --- |
| `plan` | `plan` | `journalplan` | the five content lookups + the index | `instruction` = the day's steer (`autoInstruction`) |
| `write` | `section:<i>` for the first `i` not in `sections` | `journalsection` | none | `title`, `summary`, `facts`, `outline`, `section`, `previous` — through `sectionContext()` |
| `finish` | `finish` | — (no model) | — | — |
| `done` / `failed` / `declined` | `null` | | | |

`applyStep(run, step, text): PostRun` folds a step's answer in and never
throws on a *bad answer*: an unusable one returns the same phase with
`failures + 1`, `error` set and a trail row `ok: false`. Specifically:

- **plan.** `NOTHING:` as the first label → `phase: 'declined'`,
  `error` = the reason. Otherwise `parseFields(text, PLAN_KEYS)` for
  `TITLE / SUMMARY / TAGS / ANGLE` and the tail `FACTS`, whose value is
  handed to `parsePlan(rest, { min: 3, fallback: POST_SECTIONS })` for the
  facts and the `SECTIONS` list. No title, or fewer than three sections
  *and* no facts, is unusable. A usable plan sets `phase: 'write'`.
- **section.** `cleanSection(text, heading, cap)` as the case study does;
  empty is unusable. Pushed to `sections`; when every planned section is
  in, `phase: 'finish'`.
- **finish** is not a model step: `assemblePost(run)` returns
  `{ title, summary, tags, readTime, body }` — sections joined by a blank
  line, `readTime` from the word count at 200 words a minute, `summary`
  falling back to the title as `compose()` does today. The runner inserts
  it (section D) and sets `phase: 'done'`, `slug`.

`failures >= settings.maxAttempts` → `phase: 'failed'`. A step that
*succeeds* resets nothing: `failures` counts the day's failed steps, which is
what "attempts per day" bounds.

### Two new tasks in `ASSIST_TASKS`

Both `surface: 'journal'`, `group: 'write'`, `step: true`, no `command`.

**`journalplan`** — `format: 'document'`, `keys: PLAN_KEYS`
(`title, summary, tags, angle` then `facts` as the tail), `maxTokens:
2400`, `temperature: 0.5`, `needsCorpus: true`, `context: []`. Its
instructions ask for the day's entry to be *decided* before it is written:
read the index, pick the one specific thing this entry is about (`ANGLE`),
read one or two pages for the facts, list fifteen to thirty facts in the
`FACTS` block, then three to six `## ` sections with a one-line brief each
— or answer `NOTHING: <reason>` alone if every subject in the index already
has an entry covering it. The voice rules `autoInstruction()` carries today
are sent as the steer, unchanged, so the plan is made in the same terms the
sections are written in.

**`journalsection`** — `format: 'markdown'`, `maxTokens: 1200`,
`temperature: 0.65`, `needsCorpus: false`, `context: ['title', 'summary',
'facts', 'outline', 'section', 'previous']`. The `casestudysection` rules
rewritten for a journal entry: first person, past tense, the decision and
what it cost, inline code for every identifier, a fenced block only where
the facts contain the code, continue from the previous section, this
section only.

`parsePlan()` gains an options argument `{ min?: number; fallback?:
readonly PlannedSection[] }` (defaults: 4 and `DEFAULT_SECTIONS`, so the
case study is unchanged). `POST_SECTIONS` is the journal's default arc:
*What I was trying to do*, *What I tried first, and what broke*, *What
worked*, *What is still open*.

`compose()` and its one-request post stay in `ASSIST_TASKS` for
`/write-whole-post` in the editor; the daily job stops using it.

---

## D. The runner and the endpoints

### `src/lib/agent-runner.ts` — server

```ts
export async function loadRun(db, day): Promise<PostRun | null>
export async function saveRun(db, run): Promise<void>
export async function dropRun(db, day): Promise<void>
export async function advance(db, run, options): Promise<Advanced | Response>
```

A run lives in `documents` as `run:journal-post:<day>` (one JSON column,
written whole after every step — the same shape and the same reasoning as
the two rows the job already keeps, and no migration). `saveRun` also
deletes `run:journal-post:*` rows older than three days; `dropRun` is
Discard.

`advance()` takes `{ providers, settings, caller: 'cron' | 'owner', stream:
boolean, started: number }` and does one step:

1. `nextStep()`; `null` means nothing to do.
2. **finish**: `assemblePost()`, `slugify` + `freeSlug`, `insertPost`
   (moved here from `daily.ts`, unchanged), `pinNewJournalPost`, the run
   record (`journal-auto-run`: `slug`, note *Drafted "…"* / *Published
   "…"*), one `record()` row, `phase: 'done'`, save. Returns the run.
3. **a model step**: builds the messages with `assistPrompt(task, …)` —
   corpus from `buildIndex()` for the plan, `toolsFor('assist')` (no repo
   access) when the provider row allows tools — and the call:
   `{ maxTokens: task.maxTokens, temperature, effort: 'low', timeoutMs:
   STEP_ATTEMPT_MS (120 s, headers to last byte), deadline: now +
   STEP_BUDGET_MS (240 s, when an attempt or a lookup may still start),
   tools, model }`. A step is therefore over inside about four minutes
   whatever the vendor does. Then:
   - `stream: false` → `agentComplete()`, `applyStep()`, save, one `record()`
     row (`daily`, level from the outcome), return `{ run, step, report }`.
     A `ProviderError` is a failed step like any other — `failures + 1`,
     `error`, trail — and is *returned*, not thrown; the tick decides
     whether to go on.
   - `stream: true` → `callChat()` + `agentStream()`, wrapped in a
     generator that yields `{ step: { id, label, index, total, status:
     'running' } }` first, the model's frames, then — once the model's
     frames have all arrived — runs `applyStep()` on the tallied answer,
     saves, and yields `{ step: { …, status: 'done' | 'error', ms, note }
     }` and `{ run: <public summary> }` before the final `done`. A stream
     the client cancels applies **nothing**: the wrapper's `finally` only
     clears the lock, so a stopped section is not stored half-written.
     Returns the `Response`. The route wraps nothing else.
4. The lock: `run.lock = { by: caller, at: now }` is written before the
   step and cleared after. `advance()` refuses to start when another caller
   holds a lock younger than `LOCK_MS` (4 min) — the cron tick answers
   `{ status: 'busy' }`, the owner's step answers 409 *"The schedule is
   writing this post right now."* An older lock is stale (a killed isolate)
   and is taken over.

The public summary (`summariseRun(run)`) is what every route answers and
the screen renders: `{ phase, label, done, total, failures, error, slug,
title, updatedAt, lockedBy, trail }` — never the plan's facts or the
sections themselves; those are the row's business.

### `/api/ai/daily`

- **The tick (cron).** `decide()` as today. When it acts: load today's run
  or start one (`phase: 'plan'`, `topic`), then loop `advance({ stream:
  false })` until the run is done, failed or declined, or `Date.now() -
  started > TICK_BUDGET_MS` (300 s: a last step may run four minutes more,
  and the workflow's `curl` waits ten). Between steps the settings and providers
  are not re-read. Answers `written` (200), `in-progress` (200 — not a
  failure; the next tick continues), `declined` (200, run record
  `declined: true`, no post), `failed` (502, run record note), `busy`
  (200). The attempt counter on the run record becomes the run's
  `failures`, written after every step, so `decide()`'s
  `attempts >= maxAttempts` check works unchanged; `AutoJournalRun` gains
  `declined: boolean` and `decide()` stops on it the way it stops on `slug`.
- **`force`** (owner, non-streamed) runs the same loop as the tick, ignoring
  the clock — `curl` and the old button's contract. It no longer bypasses
  the attempt counter: a forced run's failures are the day's failures.
- **`GET`** adds `work: summariseRun(run) | null`.

### `/api/ai/runs` — owner only, `prerender = false`

`POST { kind: 'journal-post', action: 'step' | 'discard' }`:
- `step`: today's run (started if absent), `advance({ stream: true, caller:
  'owner' })`, the NDJSON response. A run that is `done` answers a one-frame
  stream with `{ run }` and `done`.
- `discard`: `dropRun`, `{ ok: true }`. The run record is untouched — a
  discarded day is simply unwritten, and the next tick starts a new run.

`GET ?kind=journal-post` → `{ run: summariseRun(run) | null }`.

Every body field is matched against a literal; `kind` is a one-member union
today and a closed list tomorrow. Nothing here takes a prompt, a model, a
slug or a table.

### `ai-store.ts`

`runStep(handlers, signal)`, `discardRun()`, `loadRun()`. `StreamHandlers`
gains `onStep?(frame)` and `onRun?(summary)`; `readStream()` dispatches
them like the other frames.

---

## E. The Journal screen shows the run

- `journal.astro` renders `<AssistPanel surface="journal" sub="Shows the
  daily post being written, step by step. Nothing here changes a post." />`
  as a direct child of `.admin-main` (the freeze rule counts on it).
- `DailyJournalPanel.astro`'s script mounts it: `docSlug: () =>
  'daily-journal'`, `run` handles `chat` through `runAssist('chat', {},
  …)` with the panel's history and run options, and `blocked` answers every
  command with *"Open a post to run this command."*
- **Run now** opens the panel and drives the run: `for (;;) { const turn =
  panel.begin(label, null); await runStep({ onStep, onThinking →
  turn.thinking, onTool → turn.tool, onDelta → turn.answer(soFar), onRun },
  signal); turn.end(text); if (phase !== 'write' && phase !== 'plan')
  break; }`. The plan's turn ends with the angle and the section list as
  the answer text; each section's turn shows the section; the finishing
  frame is a panel message *Drafted "…" — open it to publish* with a link,
  or the decline's reason, or the failure with a **Resume** action. Stop
  aborts the step in flight (its output is lost; the finished steps are on
  the row) and the button reads *Resume*.
- **Status card.** `GET /api/ai/daily`'s `work` renders *In progress:
  section 2 of 4 written · 3 min ago* with **Resume** and **Discard**
  (two-click) beside *Run now*; a cron-held lock reads *The schedule is
  writing this post now — section 2 of 4* and the card re-reads every 20 s
  while the tab is visible and a run is live. *Last run* keeps its line.
- The `runAutoJournalNow()` toast path goes; `say()` on the card keeps the
  outcome sentence.

The projects import flow and the editors are untouched.

---

## F. Phase 2 — after E is verified live

1. **Auto-compaction of a conversation.** After a run ends, when the
   transcript passes `COMPACT_AFTER` (16 turns or 24,000 characters), the
   panel runs the existing Compact and adds *Compacted the earlier
   conversation into a summary (14 messages)* as a note. The button stays
   for doing it early.
2. **The long case study on the runner.** `kind: 'case-study'`, key = the
   project slug, `plan`/`section` steps on the existing `casestudyplan` and
   `casestudysection` tasks, repo lookups through the owner's bearer token
   (the step endpoint has one; the cron never runs this kind).
   `case-study-writer.ts` becomes a client of `runStep()` and its
   `LongRunState` is the row, so a reload resumes from the section that
   was streaming. The project page's Resume button reads the row on load.

Phase 2 is written in this spec so the runner's shape is decided with it in
view (`kind`, `key`, `summariseRun`), and is built only after Phase 1 has
produced a real daily post.

---

## Tests (`scripts/test-ai.mjs`)

- `agent-runs`: `nextStep` walks plan → sections → finish → null;
  `applyStep` on a good plan, a `NOTHING:` answer, a plan with no title, a
  plan with two sections and facts (falls back to `POST_SECTIONS`), a
  section, an empty section (failure counted, phase unchanged), the last
  section (→ `finish`); `failures` reaching `maxAttempts` → `failed`;
  `assemblePost` joins, computes the read time and falls back on the
  summary; `clampRun` on garbage; `summariseRun` carries no facts or
  sections; a resumed run (three sections done) asks for the fourth.
- `advance` with stubbed `fetch` and a stub `db`: a plan round with a
  lookup then an answer; a provider refusal becomes a failed step, saved,
  not thrown; the lock refuses a second caller and yields to a stale one;
  the streamed path yields `step` frames around the model frames and a
  `run` frame before `done`, and `onEnd` saved the row.
- `ai.ts`: B1 (echoed only when received, both loops), B2 (trim rule), B3
  (body timeout); the termination test still passes.
- `journal-auto`: `decide()` stops on `declined`; `clampAutoRun` reads it.
- `parsePlan` with `{ min: 3, fallback }`; the case-study default is
  unchanged.

## Documentation that moves with the code

- `CLAUDE.md`: the `documents` bullet gains the run row; `journal`'s
  Daily journal tab drives a run in the panel; the `check:ai` sentence.
- `.claude/rules/ai-assistant.md`: `agent-runs.ts` and `agent-runner.ts`
  paragraphs; `/api/ai/runs`; the daily job paragraph rewritten (steps,
  tick budget, lock, in-progress); B1–B3 in the `ai.ts` paragraph; the two
  step tasks.
- `.claude/rules/admin-surface.md`: the journal screen mounts the panel;
  the veil is on the shell.
- `docs/DECISIONS.md`: 59 and 61 amended in place; **65. The daily post is
  a run of steps, and a step is the unit of retry** — the choices and the
  rejected alternatives (a longer timeout; streaming the tick; generating
  in the runner; one `ai_runs` table).
- `docs/FEATURES.md`, `CHANGELOG.md`.

## Verification

`npm run check`, `npm run build`; headless Edge over the import form with
the panel docked, sampling the dialog's background under the freeze; the
Journal screen's tab with a stub run (`astro dev` against the local D1),
Run now → panel steps → draft row; `wrangler d1` read of the live `logs`
after the first real cron run; `npm run probe:ai` remains blocked by the
dead local key.
