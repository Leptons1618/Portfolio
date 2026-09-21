# AI runs, the log, and the daily journal — design

**Date:** 2026-09-21 · **Status:** implemented (decision 64) · **Branch:** `fix/assist-long-runs`

## Context

Five admin screenshots and two log rows, all from one afternoon on the free
OpenRouter pool with `nvidia/nemotron-3.5-lightning:free` as the only model on
the row:

1. `/admin/ai` → Daily journal: "Last run · 3 attempts · The model answered in
   no recognisable shape." A forced run took 429 s and failed the same way.
2. `/admin/logs`: that failure's `detail` is `{day, attempt, caller, ms}`.
   Nothing says what the model actually returned, there is no way to copy the
   row, and successful AI runs are never recorded at all.
3. A second forced run: "The model spent this whole run thinking — about
   12,182 tokens of deliberation and no answer." 591 s.
4. `/admin/projects` → Import project → Draft with AI → `/write-frontmatter`:
   two lookups ran, the third was refused ("no more lookups (out of time)"),
   and the model then wrote its next lookup **as text** —
   `<tool_call><function=read_repo_file>…</tool_call>` — which the panel
   showed as the answer, with "The model answered without using the field
   format, so nothing was written."
5. The same screen with the panel docked: the page behind both dialogs is
   turned dark grey by a `brightness()` filter, the pending toast sits on the
   panel's composer, and the project grid has collapsed to one column.

Two of the five are the same bug seen from two surfaces (1 and 4). One is a
second failure class with the same model (3). The rest are the log not
carrying what it needs, and three small layout faults.

## Goals

- A model that writes a tool call as text, or that spends its whole ceiling
  deliberating, is recovered from automatically, once, before a run is
  declared failed.
- Every AI run — public chat, authoring assistant, daily job — leaves one log
  row saying what answered, how long it took, what it spent, how it ended,
  and (when it failed to produce fields) what it actually wrote.
- The Logs screen can copy a row, delete a row, clear what a filter shows,
  export what a filter shows, and page in both directions.
- The daily journal's schedule lives on the Journal screen, not the AI
  screen.
- The page behind two coexisting dialogs looks like a page behind a modal,
  not a broken one; toasts and the project grid make room for a docked panel.

## Non-goals

- Changing `RUN_BUDGET_MS` (20 s) or the other run budgets — decisions 56 and
  60. The third lookup in screenshot 4 died on that clock; that is a separate
  conversation.
- A body-read timeout on the daily job's non-streamed answer round. The
  workflow's ten-minute `curl` and the owner's patience bound it today.
- Making the daily job send `reasoning_effort: none` on its *first* try.
  `low` stays; `none` is the retry.
- A second log table, an archive flag, or any log written per anonymous
  request. Decision 62 stands.

---

## A. The tool loop recovers from two model habits

Both loops in `src/lib/ai.ts` — `agentLines()` (streamed) and
`agentComplete()` (the daily job) — gain the same two rescues. Each fires at
most once per run on its own flag — A1 adds `nudged`, A2 extends the existing
`switched` — so a run gains at most two extra rounds and the termination
guarantee `check:ai` pins is unchanged.

### A1. A tool call written as text is a lookup request, not an answer

**`textToolCalls(content): ToolCall[] | null`** — a pure parser, exported for
the test. It recognises `<tool_call>…</tool_call>` blocks in the two shapes
the open-weight models write:

```
<tool_call>
<function=read_repo_file>
<parameter=repo>Leptons1618/artifact-report</parameter>
<parameter=path>SKILL.md</parameter>
</function>
</tool_call>
```

and `<tool_call>{"name": "read_post", "arguments": {"slug": "…"}}</tool_call>`.
Parameters become the `arguments` JSON string a real tool call would carry;
ids are synthesised as `text_<round>_<i>`. It returns `null` unless at least
one block parsed **and** the text outside the blocks, trimmed, is shorter
than `HOLD_CHARS` (240) — a response that is mostly prose with a stray block
in it is an answer, and is left alone.

What happens next depends on whether the round still had tools:

- **Tools armed:** the parsed calls are treated exactly as `tool_calls` from
  the API — the assistant message is pushed with `tool_calls` synthesised
  alongside its text content, each call runs (or is refused by the same
  round/call/deadline rules), and the loop continues.
- **Tools withdrawn:** the assistant text is pushed as-is, followed by one
  `user` turn — *"No lookups are available for this answer. Write it now,
  from what you already have, and say plainly if something is missing."* —
  and one more answer round is sent through `answerCall()`. A `user` turn
  after an `assistant` turn is valid everywhere; the `tool` role is not
  used because there is no real call id to answer. Once per run (`nudged`).
  A second text-shaped call after the nudge ends the run: the streamed loop
  yields `{ error: 'The model kept asking for lookups after they were
  withdrawn.' }`, `agentComplete` throws the same sentence.

**Streaming.** The held opening (`held`, currently only on rounds with tools)
now also applies to the answer round, but only while the text so far is a
prefix of a tool block: `/^\s*<tool_call/.test(said) ||
'<tool_call>'.startsWith(said.trim())`. Ordinary answers still stream from
the first character. A held block is released as a `thinking` frame, never a
`delta`, so no editor field ever receives `<tool_call>` text. The panel's
existing "no field format" salvage state is unchanged for genuinely
malformed answers.

### A2. A deliberation-only round is retried with reasoning off

`EFFORT_LEVELS` in `src/lib/ai-catalog.ts` becomes
`['none', 'low', 'medium', 'high']`. `none` is sent as
`reasoning_effort: 'none'`, which OpenRouter maps to "reasoning disabled" on
every model that allows it, and which Groq and GPT-5.1+ accept natively. A
model that cannot switch reasoning off answers 400, which `callChat` already
treats as that attempt failing. No migration: `reasoning_effort` has no CHECK
constraint and `clampEffort()` is the gate on read.

The one-time handover for a round that produced reasoning and nothing else
becomes a two-rung ladder:

1. the next model on the row, as today (`nextModel()`);
2. otherwise the **same model with `effort: 'none'`**, unless the round was
   already sent with `none`.

The streamed loop announces the retry in the thinking channel the way it
announces a model switch (*"[model spent its whole allowance thinking and
wrote nothing — asking again with reasoning off.]"*). `agentComplete` folds
it into the error text when the retry also fails: *"…12,000 tokens of
deliberation and no answer, and a retry with reasoning off did the same.
Pick a different model on the Daily journal tab of the Journal screen."*

The two hard-coded effort pickers — `AssistPanel.astro` and the provider
dialog on `/admin/ai` — gain an **Off** option (`value="none"`); the public
assistant's Thinking select already renders from `EFFORT_LEVELS`.

### Tests (`scripts/test-ai.mjs`)

- `textToolCalls`: both shapes parse to the right name and arguments; a
  prose answer with a block in it returns `null`; a block alone returns the
  call; malformed markup returns `null`.
- Stub loop, streamed: a round with tools withdrawn answers a text tool
  call; assert exactly one nudge `user` turn is sent, no `delta` frame ever
  contains `<tool_call`, the block arrives as `thinking`, and the run ends.
- Stub loop, `agentComplete`: same, and a second text call after the nudge
  throws the stated sentence.
- Reasoning-only round on a one-model row: assert the second request body
  carries `reasoning_effort: "none"`, and that a row already at `none` is not
  retried.
- The existing "asks forever" termination test still passes with both
  rescues in the loop.

`npm run probe:ai --model nvidia/nemotron-3.5-lightning:free` after
implementation, to see the real model's behaviour end to end. (Not run: the
`OPENROUTER_API_KEY` in the local `.env` answers 401 "User not found"; the
working key is the one in D1. Run it with a valid key before merging.)

---

## B. The daily job says what the model wrote

`Completion` (what `agentComplete()` returns) gains `model` (the
`label · model` that answered), `rounds`, and `usage`
(`{prompt, completion}` when the vendor's body carries one).

`compose()` in `src/pages/api/ai/daily.ts` throws a `ComposeError` — an
`Error` with a `detail` object — for every failure it currently reports as a
plain `Error`:

```ts
{ model, stopReason, calls, rounds, reasoningChars, answerChars,
  head: text.slice(0, 600), usage }
```

The route spreads `error.detail` into the log row's detail beside the
existing `day/attempt/caller/ms`. A `ProviderError` keeps its existing
shape (status and message). The success row gains `model`, `calls`,
`rounds`, `answerChars`, `usage`.

`head` is the model's own text; no visitor is involved, so decision 62's
"never a visitor's words" is untouched.

---

## C. Every AI run is one log row

### The tally

`agentStream()` wraps whichever generator it returns — `sseLines()` (the
no-tools fast path, extracted from `ndjsonFromSSE()`) or `agentLines()` —
in a `tallied(lines, summary, onEnd)` generator that watches frames on their
way to `linesToStream()`:

```ts
interface RunSummary {
  model: string;          // the row's label · model that answered
  ms: number;
  answerChars: number;    // from `delta` frames
  thinkingChars: number;  // from `thinking` frames
  lookups: number;        // `tool` frames with status 'running'
  stopReason: string;     // from the `done` frame
  error?: string;         // an `error` frame, or a throw
  usage?: { prompt: number; completion: number };
  answer: string;         // accumulated `delta` text, for the route's shape check
}
```

The summary object is created by `agentStream()` from `first.provider` and
passed into `agentLines()` as `options.summary`, which overwrites `model`
when the run switches models and sets `usage` when a chunk carries one.
`sseEvents()` learns one new event kind, `{ kind: 'usage', prompt,
completion }`, emitted when a streamed chunk has a `usage` object; `frameFor`
drops it. **Nothing new is sent to any vendor** — no `stream_options`, no
`usage.include` — because a strict vendor 400s on a field it does not know,
and the row is useful without token counts.

`onEnd(summary)` runs in the wrapper's `finally`, awaited, before the
generator returns and `linesToStream()` closes the response. It therefore
also fires when the client cancels (`lines.return()`). It is wrapped so a
throw inside it cannot fail the stream.

Cost: one string append per `delta` frame, already done today in
`agentLines` as `said +=`; one D1 `record()` per run.

### The rows

| Route | Level | Message | Detail |
| --- | --- | --- | --- |
| `assist` | info | `Wrote the whole post · nemotron-3.5 · 41 s` | `task, model, effort, lookups, ms, answerChars, thinkingChars, stopReason, usage, shape` |
| `assist` | warn | same, when `stopReason === 'length'`, thinking-only, or `shape === 'unrecognised'` | plus `head` (600 chars) when unrecognised |
| `assist` | error | `Task label: <error>` (as now) | as now, plus the summary |
| `chat` | info / warn / error | `Answered · model · 6 s` | `model, ms, lookups, answerChars, thinkingChars, stopReason, usage` — **no question, no answer text** |
| `daily` | info / error | as now | as in B |

`shape` is computed by the assist route for `format: 'document'` tasks only:
`parseFields(summary.answer, task.keys).recognised ? 'fields' :
'unrecognised'`. One parse per run, at the end.

The public route writes a row only for a run that was **charged** — the
provider is only called after `charge()` — so it stays inside decision 62's
rule ("authenticated, or spent a metered budget"). Screened refusals and
rate-limit refusals are not logged, as now. The ceiling on rows is
`perDayTotal` (≤ 2,000), against D1's 100,000 daily writes.

---

## D. The Logs screen

### `/api/logs`

- `GET` gains `after=<id>` beside `before=<id>`: `id > ?` ordered ascending,
  limited, then reversed before the response so rows are always newest
  first. Both cursors, `source` and `level` remain closed-list, bound
  parameters.
- `DELETE` gains three optional filters, all bound: `id` (one row),
  `source`, `level`. With none it empties the table as now. Responds
  `{ ok, removed }`.

### The screen

- **Per row:** a `Copy` button (`copyText()` from `src/lib/clipboard.ts`
  with `at · level · source\nmessage\n<pretty detail>`) and a `Delete`
  button, two-click like every delete on the surface. Error rows render
  their `<details>` open; `pre` gets `white-space: pre-wrap`.
- **Paging:** the foot reads `rows 1–100 of 342` with `Newer` / `Older`.
  Both are keyset (`after` / `before`); a filter change or Refresh returns
  to the newest page. 100 a page, unchanged.
- **Export:** a head button that walks the current filter with `before` until
  a short page, then downloads `logs-<YYYY-MM-DD>.json` through the same
  `Blob` + `URL.createObjectURL` pattern the resume export uses. That is the
  archive.
- **Clear:** deletes what the filter shows. The label reads `Clear shown`
  while a source or level filter is active and `Clear` otherwise; the
  confirm copy says how many rows the current page reports.

Rows are still built with `createElement` and `textContent`; nothing from a
row reaches an HTML parser.

---

## E. The schedule moves to the Journal screen

- **`src/components/DailyJournalPanel.astro`** — the Daily journal panel's
  markup and script, lifted from `/admin/ai` as one component. Its script
  registers `onAdminPage('#dj-panel', init)` and owns everything it needs:
  its own **Save schedule** button (in the panel, above the two columns,
  not in the page head), `loadOverview()` for the model picker,
  `loadAutoJournal` / `saveAutoJournal` / `runAutoJournalNow`,
  `clampAutoSettings` / `dayOf` / `hourFor`, `setBusy` / `toast` /
  `trackDirty`. The `$()`, `say()` and `fail()` helpers it used on the AI
  screen are re-created locally. Nothing about the schedule's storage or
  the endpoint changes.
- **`/admin/journal`** gets a `.tab-bar` above the manifest — **Entries** |
  **Daily journal** — wired by `wireTabs()` from the page's existing
  `onAdminPage('#admin-journal', …)`. The manifest's markup moves into
  `#jl-panel-entries`; the component renders inside `#jl-panel-daily`
  (`hidden`, server-marked). The tab panels carry no page-scoped layout
  class (the rule in `admin-surface.md`).
- **`/admin/ai`** loses its third tab, the `#ai-panel-daily` markup, the
  daily script block, `#ai-save-daily`, and the `providers` cache that
  existed for the daily picker. Back to decision 44's two tabs.
- `saveAutoJournal()` in `ai-store.ts` returns `url: '/admin/journal'`.
- **Rejected:** a `/admin/journal/daily` route — `[slug].astro` would lose
  any post slugged `daily` or `schedule` to it.

---

## F. Freeze look, toast, grid, dropdown

- **Scrim, not filter.** `admin.css` replaces the
  `filter: brightness(0.55) saturate(0.6)` rule with
  `body[data-asx-freeze]::after { content: ''; position: fixed; inset: 0;
  z-index: 64; background: <the .modal::backdrop colour>; }`. It sits above
  the page, the sticky tab bar (20) and the route progress (60), below a
  stepped-down dialog (65), the panel (70) and the toast host (80, top
  layer). `syncFreeze()` and `inert` are unchanged — the page stays
  non-clickable so a stray click cannot navigate away and drop the form.
  Decision 59's text is updated to say the look is a backdrop.
- **Toasts make room.** The same `@media (min-width: 621px)` block that
  shifts a stepped-down dialog away from the dock column shifts the toast
  host: docked right, `right: calc(var(--asx-dock-w, 608px) + var(--space-4))`;
  docked left, `left: …; right: auto; align-items: flex-start`. A floated
  panel is left alone.
- **Grid.** `.pm-grid`'s column minimum drops from 440 px to 400 px so two
  columns survive a docked panel at 1794 px (`1794 − 260 − 608 − 2×24`
  leaves ≈ 860 px; two 400 px columns and a gap fit, two 440 px ones do
  not).
- **Dropdown.** Reproduce screenshot 4 with Playwright against `astro dev`
  (signed out, open Import, open the case-study select, screenshot after
  200 ms). If the menu is opaque and the caret is turned, the fault was the
  capture; record that in the plan and move on. If it reproduces, fix in
  `select.ts` / `global.css` under this spec.

---

## Documentation that has to move with the code

- `CLAUDE.md`: `ai` is two tabs; `journal` has the schedule tab; the
  `logs` line gains export/scoped clear; `check:ai` sentence gains the two
  rescues.
- `.claude/rules/ai-assistant.md`: `agentStream`/`agentComplete` paragraph
  (rescues, summary, `onEnd`); `EFFORT_LEVELS` includes `none`; daily job
  paragraph (diagnostics, retry).
- `.claude/rules/admin-surface.md`: the Logs paragraph; the AI screen is two
  tabs; the journal screen's tab bar; the freeze look.
- `docs/DECISIONS.md`: decisions 44, 52, 59 and 62 amended in place; one
  new entry, **64. A run is logged, a text tool call is a lookup, and the
  schedule lives with the journal**, recording the three choices and their
  rejected alternatives.
- `docs/FEATURES.md` and `CHANGELOG.md` entries.

## Verification

`npm run check` (includes `check:ai` and `astro check`), `npm run build`,
`npm run probe:ai` against the nemotron model, and a Playwright pass over:
the Logs screen with >100 rows (paging both ways, copy, delete, scoped clear,
export), `/admin/journal` tabs, `/admin/ai` two tabs, the import modal with
the panel docked (scrim, toast position, two-column grid), and the dropdown
capture.
