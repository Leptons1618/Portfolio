# AI agent efficiency, Jev routing, and resumable runs

**Date:** 2026-10-05
**Status:** written design — awaiting owner review
**Branch:** `feature/ai-agent-enhancements`
**Related design:** [Agent runs](2026-09-21-agent-runs-design.md)

## Intent

Improve the existing assistants and daily journal agent where repeated
reasoning, repeated context, or oversized requests spend the available token
and time budgets. Preserve the closed task/tool surfaces and keep private model
reasoning out of public replies. Add Jev as an optional, configurable typed
decision service that can narrow the context and tools sent to the answer
model. Complete the already-designed per-step resumable daily run.

The success measure is lower total provider input tokens and fewer wasted
rounds without an increase in wrong or unsupported answers. Jev's own input,
latency, and reported usage count toward that total; a smaller answer-model
prompt alone is not a saving.

## Current state

- `agentStream()` and `agentComplete()` already cap rounds and tool calls,
  bound streamed requests, preserve provider fallback behavior, and withdraw
  tools when limits are reached.
- `ChatMessage` does not carry provider reasoning fields. A tool-call turn
  therefore cannot replay `reasoning_details` or `reasoning_content` that the
  same provider supplied.
- Each tool result is individually capped, but older results remain at full
  size in later requests.
- The public route has question screening, request budgets, a narrow corpus,
  read-only tools, and a public frame filter. Commit `8e03e43` removes public
  reasoning text and tests that the public stream does not expose it.
- The daily scheduler stores settings and run state, but the bounded,
  resumable plan/section/finish engine described in the related design is not
  present in this branch. This work carries that design forward rather than
  treating the single-generation daily route as resumable.
- Chat providers use `/chat/completions`. Jev is a typed decision model with a
  distinct Decisions/System One API, so it needs a separate transport adapter.

## Decisions

### 1. Improve context and round handling in the existing agent

Keep the existing hard ceilings and per-surface round limits as the initial
baseline. Do not increase them to solve reasoning-only runs. Add these focused
changes:

1. Carry optional `reasoning_details` and `reasoning_content` on assistant
   messages. Accumulate the streamed `reasoning_details` entries according to
   their indexes and carry vendor fields back unchanged only when that provider
   supplied them. Do not forward them to another provider or to a public
   client. This avoids making a compatible reasoning provider reconstruct its
   prior tool-call reasoning on every round.
2. Before a later round, trim tool results from older assistant turns to a
   fixed short excerpt and an explicit already-read marker. Keep the latest
   round's results intact. Make compaction a pure helper and test the boundary
   so a one-round request is unchanged.
3. Bound non-streamed attempts across both response headers and body reads.
   Keep one attempt timer active until the response body is consumed; a slow
   body must fail within the configured timeout and may proceed through the
   existing bounded fallback path.
4. Keep stable system prefixes cacheable, avoid repeating full tool output,
   and ask for a concise answer without requesting a chain-of-thought trace.
   Use the existing effort/fallback controls to recover from reasoning-only
   output rather than adding an unbounded retry.
5. Aggregate provider-reported usage across rounds where available. Log token
   totals, cached input, rounds, tool calls, model labels, latency, and Jev
   usage without logging public question text or answers. This is the evidence
   used to tune future ceilings.

### 2. Add Jev through a separate decision-provider path

Add an owner-configurable Jev feature to the existing AI settings screen. It is
off by default. The configuration supports:

- OpenRouter's Decisions endpoint, reusing a configured OpenRouter credential;
- a direct Jev/System One endpoint; and
- a custom endpoint only when it implements the same typed decisions contract
  (`model`, `state`, `questions` request and validated typed `answers`).

Keep this configuration separate from chat-completion provider rows so a
decision-only endpoint can never be selected for `/chat/completions`. Store
decision provider settings in a dedicated `ai_decision_providers` table. An
OpenRouter decision row references an existing OpenRouter chat-provider row
for its credential; a direct/custom row stores its own write-only key. The
owner-only configuration API returns a key fingerprint, never a key, and
supports an explicit key-clear operation like the existing provider editor.
The AI settings document holds the Jev enabled switch and selected decision
provider. Validate the protocol and HTTPS endpoint before use. Use `fetch()`
and local response validation; add no SDK dependency.

Jev runs at most once at the start of an eligible public chat or owner
conversational `chat` task, when tools are enabled. One typed request asks four
fixed yes/no questions: whether the request needs published work, writing,
resume, or repository context. Repository is not offered on the public
surface. The model receives only the last four validated turns, capped at
3,000 characters, and fixed lookup-category descriptions — not full page
bodies, secrets, or repository contents. A probability at or above `0.90`
includes that category; at or below `0.10` excludes it. If any answer is
missing, invalid, or between those thresholds, use the current full context and
tool set. The selected categories may only narrow the route's server-allowed
index and tools. Published-work selection offers `search_content`,
`read_project`, and `read_case_study`; writing selection offers
`search_content` and `read_post`; resume and repository selections offer only
their existing read tools. Jev never supplies tool names, arguments, prompts,
or authorization decisions.

Run Jev after public request screening and rate charging, but before loading
corpus rows, so a confident no-lookup result can skip those reads as well as
the tool schemas. The request timeout is at most three seconds and is shortened
to the remaining run budget. Do not call Jev for fixed authoring tasks, a
disabled Jev feature, or a run whose provider has tools turned off.

Require conservative confidence for every decision before narrowing. An
uncertain, missing, malformed, disabled, or failed Jev response uses the
current full context/tool route. A Jev timeout is bounded by the run deadline;
do not automatically replay a decision POST after an uncertain outcome. Public
rate accounting applies before the Jev call, and public frames reveal neither
Jev's output nor its provider diagnostics. Owner logs may retain the selected
route and confidence values, without the input text.

Jev is a router and typed evaluator, not a text generator or a chain-of-thought
engine. It does not replace the answer model, the public scope prompt,
`ai-guard.ts`, `toolsFor()`, or `runTool()`. If later used to approve a
side-effecting action, that action needs a separate fail-closed design; this
work adds no such tools.

### 3. Implement resumable daily runs from the existing design

Implement Phase 1 of the related agent-runs design: the plan/write/finish
state machine, `documents` row keyed by UTC day, `agent-runs.ts` pure state
helpers, `agent-runner.ts`, the owner `/api/ai/runs` route, and the Journal
screen's progress/resume controls. Persist each completed step, retry only a
failed/incomplete step within the existing attempt ceiling, and protect the
run with a stale-recoverable lock shared by cron and the owner. Keep the daily
tick bounded so the next tick can continue unfinished work. The existing
spec's Phase 2 conversation compaction and long case-study runner remain out
of scope until Phase 1 is verified live.

Each section prompt carries the validated plan, required facts, and only the
previous section context needed for continuity. It does not replay the full
conversation, previous tool payloads, or private reasoning. Completed sections
are never regenerated during resume. The final draft/publish behavior remains
the existing owner-controlled setting; this change does not grant a model new
write or publish authority.

Use Jev only for eligible conversational routing. Do not spend an extra Jev
request on each deterministic journal step.

### 4. Public output and safety boundaries

The public stream contains the answer, minimal wait phase, and lookup status
needed to explain progress. It does not contain reasoning text, usage/cost,
provider errors, tool result previews, Jev responses, or internal routing
details. The existing `forPublic()` projection is the boundary and receives a
regression test for every new frame type.

Public and owner tool lists continue to be derived from their existing surface
rules and credentials. Jev can only remove tools from that list; execution
still validates the tool name, arguments, repository access, and result cap in
the existing server code. On Jev failure, routing falls back to the current
allowed tool list rather than granting access or refusing an otherwise valid
question.

## Data flow

```text
request
  → existing auth, scope screen, and rate budget
  → optional bounded Jev typed decision
  → intersect Jev route with server-allowed context and tools
  → answer model with compact prompt and existing round/call ceilings
  → compact older tool results; preserve provider reasoning only for replay
  → aggregate private metrics and durable run step state
  → public frame projection or owner-only assistant stream
```

## Failure behavior

- Jev disabled or not configured: current agent path, unchanged.
- Jev unavailable, timed out, or returned an invalid schema: current full
  allowed context/tool set; one bounded attempt and no automatic POST retry.
- High-confidence Jev route: use only the selected subset of tools already
  authorized by the route.
- Answer provider exhausts its time, round, or call budget: existing bounded
  fallback/disarm behavior; do not restart completed daily-run steps.
- Invalid persisted run data: clamp it to the documented safe state; do not
  trust arbitrary fields or locks from JSON.
- Public provider or Jev error: generic user-facing failure; detailed provider
  information stays in owner logs.

## Verification

Add focused checks for:

- replaying reasoning fields only to the originating provider and never into
  public frames;
- streamed reasoning-fragment aggregation and unchanged behavior when fields
  are absent;
- older tool-result compaction while preserving the latest round;
- a non-streamed response body exceeding its attempt timeout;
- OpenRouter, direct System One, and custom decision endpoint URL/auth/body and
  strict response parsing, with mocked fetches;
- Jev high-confidence narrowing, low-confidence fallback, outage fallback,
  and inability to add an unauthorized tool;
- resumed run state, completed-step preservation, retry limits, and stale
  locks;
- public frame filtering for new status and error frames.

Run `npm run check:ai`, `npm run check`, and `npm run build`. Inspect the final
diff and verify the new branch is pushed with its upstream set.

## Risks and limits

- Jev adds an upstream call, latency, and input usage. Net savings are unknown
  until measured; the feature stays off by default and logs both sides of the
  comparison.
- Jev probabilities can be uncertain or vary between identical requests. The
  conservative fallback protects availability and tool authorization, but an
  incorrect high-confidence route can still omit useful context. The compact
  route choices and confidence threshold need tests and post-deploy review.
- Provider reasoning replay is provider-specific. Fields are only replayed to
  the same provider and only if it sent them; unsupported vendors receive no
  new fields.
- Durable run behavior is new implementation work. D1 locking and concurrent
  cron/owner calls need explicit tests before deployment.

## Out of scope

- Exposing chain-of-thought or Jev's decision trace to public visitors.
- Letting Jev write answers or invoke tools.
- New side-effecting tools, automatic publication, or changes to the existing
  publish setting.
- Raising current model, per-user, or site-wide ceilings before usage data
  supports it.
- Arbitrary provider-specific SDK dependencies.
