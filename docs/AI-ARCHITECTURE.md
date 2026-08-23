# AI Architecture

How the AI systems on this site work: the public chat assistant, the authoring
assistant in the admin, the tools a model may call, the guards around all of
it, every request route, and how identity is decided. Written from source —
every claim here points at the file that makes it true.

Companion documents:

- `docs/FEATURES.md` — feature tracker (what exists, what was cut, why)
- `docs/DECISIONS.md` — the structural whys, referenced throughout as decisions
- `docs/admin-ai.html` — the admin-side AI features, technical walkthrough (HTML)

---

## The one-line map

```
Public visitor                    Owner (admin)
────────────────                  ──────────────────────────────
AskWidget.astro                   JournalEditor · project editor · resume editor
  │ sessionStorage cache            │ assist-panel.ts (chat + commands)
  ▼                                 │ ai-store.ts (settings/providers writes)
GET /api/ai/status ──┐              ▼
POST /api/ai/chat ◄──┘         POST /api/ai/assist
POST /api/ai/chats*                ├─ /api/ai/chats   (transcripts)
      * owner-only                 ├─ /api/ai/models  (model picker)
                                   ├─ /api/ai/providers (screen reads + Test)
                                   ├─ /api/content    (ALL row writes)
                                   └─ /api/media      (image upload/list)

Shared engine:  src/lib/ai.ts          — providers, streaming, tool loop
Grounding:      src/lib/ai-corpus.ts   — what the model may know
Guard rails:    src/lib/ai-guard.ts    — what it may be asked, how often
Tools table:    src/lib/ai-tools.ts    — what it may look up, and how
Catalog:        src/lib/ai-catalog.ts  — provider presets, param allowlists
```

---

## 1. The public assistant ("Ask about me")

**Surface:** `src/components/AskWidget.astro`, mounted by `BaseLayout` on every
public page.

### Lifecycle

1. **Hidden by default.** The widget ships `hidden`; nothing appears until a
   fetch says otherwise.
2. **One status check per browser session.** `GET /api/ai/status` answers
   `{ enabled, greeting, suggestions, maxQuestionChars }`. The answer is cached
   in `sessionStorage` under `om-ask-status`, so a visitor reading eight pages
   wakes the Worker once (`status.ts` header comment). The response itself is
   edge-cacheable for five minutes.
3. **Launcher appears only when both halves are ready:** `settings.enabled`
   (the author's switch) **and** at least one provider with a key
   (`usableProviders()`). A launcher that opens onto an error is worse than no
   launcher.
4. **Questions stream.** `POST /api/ai/chat` returns NDJSON frames:
   `{"thinking":…}` then `{"delta":…}` lines, with optional
   `{"tool":…}` rows above the answer showing which lookups ran, their argument,
   and duration.

### What it costs and who pays

The owner pays per token. Every guard below exists because of that sentence.

| Guard | Mechanism | File |
|---|---|---|
| Feature switch | `enabled` row; off → 503, widget hides | `getAiSettings()` |
| Input caps | per-message chars, turn count, total history chars — truncation keeps the most recent turns; oversized current question is refused, not truncated | `boundTurns()` |
| Scope filter | deterministic denylist on unmistakable misuse shapes ("write me a python script", "ignore your instructions", fenced code, bare arithmetic). Fires before any spend; refusal costs no provider call but is still metered against the caller's hour (`countsAgainstDay: false`) so it can't be probed free | `screenQuestion()` |
| Rate budgets | two buckets charged **before** the model call: per-IP hourly + site-wide daily. Atomic single-statement increments (`INSERT … ON CONFLICT … RETURNING`), no refund on vendor failure (a loop that errors is still a loop) | `charge()` |
| Caller identity | SHA-256 of `CF-Connecting-IP`, salted with the UTC day → the rate table is a counter, never a log; hashes rotate daily so requests can't be correlated across days | `callerKey()` |
| Output ceiling | `maxOutputTokens` clamped to `MAX_OUTPUT_CEILING`; temperature pinned at 0.2, not configurable | route |
| Reasoning channel | thinking arrives as separate frames, never mixed into the answer | `thinkStripper()` |
| Tool bounds | max 2 rounds / 8 calls on this surface; tools physically withdrawn when budget exhausts | `agentStream()` |

### The three-defence honesty statement

`src/lib/ai-guard.ts` opens with it, and it is the correct mental model:

1. **Cost** — defended by budgets and caps. A system prompt does nothing here.
2. **Scope** — the denylist is a convenience; the scope prompt decides scope;
   neither is a guarantee.
3. **Disclosure** — the only *reliable* defence is structural: unpublished
   content is never in context, so no prompt can extract it
   (`ai-corpus.ts`). Contact details (email/phone/address) are absent from the
   corpus and from every tool result for the same reason.

The design assumption is that a determined visitor can make the model say
something off-topic — acceptable because blast radius = few hundred tokens ×
a handful of calls/hour × a context containing nothing private.

---

## 2. Grounding: what the assistant knows

`src/lib/ai-corpus.ts`. Two builders over the same filtered content:

- **`buildCorpus()`** — the whole site as one markdown block. Still used to
  *report size* in the admin; no longer sent on requests.
- **`buildIndex()`** — what a request carries now: one line per published
  thing (slug · title · category/year · stack · summary), plus identity and a
  resume digest. Bodies arrive through the tools when the model asks.

Both apply the visibility filters **twice**: the route fetches through
`content.ts` (public filters already applied), then re-filters on the shape it
received. The second filter is a function with a test
(`scripts/test-ai.mjs` hands it a hidden project and a draft post and asserts
neither survives). Draft posts visible in dev via `getPosts()` are still
excluded here — published-only in every environment.

Excerpts are capped (2000 chars case studies, 1200 posts), truncation marked
`[…truncated]`, image/link syntax stripped to text.

There is deliberately **no vector store**: the corpus is tens of KB; a table
of contents is a complete index at that size. `corpusSize()` reports the
numbers that would prove this wrong.

---

## 3. Tools: what a model may look up

`src/lib/ai-tools.ts`. Five read-only functions, closed table, OpenAI-style
JSON Schema written by hand per tool:

| Tool | Args | Returns |
|---|---|---|
| `search_content` | `query`, optional `kind` ∈ project/post/case_study | scored hits (title match ×3, body ×1), top 8, capped |
| `read_post` | `slug` | full published post body (8000-char cap) |
| `read_project` | `slug` | full record incl. highlights, links |
| `read_case_study` | `slug` | problem/solution/achievements/body |
| `read_resume` | optional `section` | experience/skills/education/certifications — **never contact details** |

Invariants, enforced per call:

- Re-filters through `publicProjects()` / `publicPosts()` regardless of caller.
- Arguments are slugs or search strings — never SQL fragments. Placeholders
  live in `content.ts`; matching happens in memory.
- Exact slug matching: an invented slug gets "there is no published post…",
  not the nearest row.
- Results are strings, capped at 8 000 chars per call; `MAX_TOOL_CALLS = 8`
  per answer overall.
- Unknown tool name → an *answer* telling the model its real options, not an
  error frame (models stop on errors; they retry correctly on prose).

Why this replaced whole-corpus prompts: a ten-turn conversation paid for the
entire site ten times, and on reasoning models the reference crowded out the
output ceiling entirely (decision 37).

---

## 4. The request routes

All under `src/pages/api/`, all `prerender = false`.

### Public (no auth)

| Route | Method | Purpose | Guards |
|---|---|---|---|
| `/api/ai/status` | GET | launcher visibility + greeting/suggestions/limits | none needed; no secret, edge-cached 300s, session-cached client-side |
| `/api/ai/chat` | POST | stream an answer | settings enabled → shape/caps → scope screen → budgets → providers exist → build index → model. NDJSON out; `Retry-After` on 429; vendor error text kept server-side, generic message to visitor |

### Owner-only (`requireOwner()` first, before body parsing)

| Route | Method | Purpose |
|---|---|---|
| `/api/content` | POST | THE write endpoint for all rows (projects, case_studies, journal, documents, ai_providers): create / patch / delete by slug. Column allowlist in `content-schema.ts`; markdown rendered server-side into `body_html` (Shiki disabled — WASM is banned on Workers); constraint failures mapped to human messages (409) |
| `/api/media` | GET | media library index (path/mime/size, **not** bytes; cap 200) |
| `/api/media` | POST | upload image → D1 blob, replace-by-path upsert, MIME allowlist, 2 MB cap |
| `/api/ai/assist` | POST | the authoring assistant (see §6) |
| `/api/ai/chats` | GET/LIST/append/delete | authoring transcripts; fixed hand-written SQL (append needs autoincrement ids the slug-keyed generic endpoint can't express); caps: 20k chars/message, 400 msgs/chat, 60 chats listed |
| `/api/ai/providers` | GET | AI screen read: providers (key masked/absent), raw settings, corpus vs index sizes, today's usage. POST = Test button: real 8-token completion against one provider — not `callChat()`, so a fallback can't fake a green tick |
| `/api/ai/models` | GET | proxy to `{baseUrl}/models` behind the picker; normalises vendor JSON defensively; key sent outbound only; failures are `{ models: [], error }` at 200 |

### Serving

| Route | Purpose |
|---|---|
| `/media/[...path]` | serves uploaded blobs from D1 with extension-derived MIME (stored MIME trusted only if it was accepted at upload); immutable cache headers |

### GitHub OAuth Worker (separate deploy)

`workers/github-oauth/` — exchanges an authorization code for a user token;
holds the client secret; stores nothing, logs nothing, discards the refresh
token so only the short-lived (~8 h) credential reaches the browser. CORS
allowlist by origin. Setup: `workers/github-oauth/README.md`.

---

## 5. Identity and authorization

Two different problems, solved twice on purpose.

**Writing** (`src/lib/authorize.ts`): no site-owned API key. The browser sends
the GitHub user access token it already holds from sign-in; `requireOwner()`
asks GitHub who it belongs to and requires `login === site.githubUser`.
Properties: no secret stored server-side; revocation is GitHub's (sign-out /
8-hour expiry / App uninstall); fails closed including GitHub-unreachable
(503); identical message for "unknown token" and "wrong account" (403) so the
endpoint doesn't leak who *may* write. Limits acknowledged in-source: this
authenticates the writer, not the device; it is not a rate limiter.

**Reading public content**: no auth anywhere — pages, RSS-ish JSON feeds of
content, `/api/ai/status`. Public content is public.

**Spending money unauthenticated**: exactly one endpoint (`/api/ai/chat`),
and §1's guard stack is the reason it can be public.

---

## 6. The authoring assistant (admin)

Full technical walkthrough: **`docs/admin-ai.html`**. Summary:

- One route (`/api/ai/assist`), one **closed task table**
  (`src/lib/assist-tasks.ts`) — 19 tasks across journal / project / resume
  surfaces plus plain `chat`. An unknown task name is a 400 listing valid
  names, never a forwarded prompt.
- Tasks declare: prompt contract, output format (`document` / `markdown` /
  `lines` / `mermaid`), ceilings, temperature, whether they need the content
  index (`needsCorpus`), required context fields, and delivery mode —
  `live` tasks stream straight into the field (with Undo snapshots);
  selection rewrites preview beside the selection until Replace.
- **It never saves.** Everything lands in the editor; the author presses the
  same Save button as ever.
- Independent of the public switch: `enabled=false` kills strangers' questions,
  never the author's own tools.
- Model choice validated against configured rows only (`pickModel`) — a stolen
  session cannot name an arbitrary expensive model.
- Transcripts persist to `ai_chats`/`ai_messages` with a separate `note` role
  that must never be replayed as an assistant turn; `thinking` stored beside,
  never inside, the answer.

---

## 7. Provider engine internals

`src/lib/ai.ts` — "who answers":

- **Provider = one row** (`ai_providers`): base URL + model + key + flags.
  Any OpenAI-compatible `POST {base}/chat/completions` works; no adapter layer
  by design.
- **Fallback walk:** active rows ordered by `priority`; a failure walks to the
  next. Later rounds pin to the provider *that answered* — splicing vendors
  mid-answer is not fallback.
- **Key handling:** server-only reads; outbound only as `Authorization`;
  `summarise()` builds responses key-by-key so new columns can't ride along;
  `maskKey()` for display; `test-ai.mjs` asserts the serialized payload can't
  contain the key.
- **Reasoning split:** `thinkStripper()` separates `<think>` tags,
  `delta.reasoning`, and narrated chain-of-thought into `{"thinking":…}`
  frames; answers travel only as `{"delta":…}`. Decision 29.
- **Token ceilings:** `max_tokens` covers thinking+answer, so task ceilings
  are raised to the model's real maximum via `effectiveMaxTokens()` rather
  than truncated mid-thought.
- **Cacheable prefix:** system prompt emitted as one leading message marked
  `cache:true`; converted to Anthropic-style breakpoints where supported,
  dropped elsewhere (implicit prefix caching covers the rest).
- **SSE→NDJSON bridge:** `ndjsonFromSSE()` converts vendor streams; its
  `pull` enqueues ≥1 line or closes — a pull that queues nothing deadlocks
  the reader while tokens bill upstream.
- **Settings clamp:** saved settings cannot exceed `CEILINGS`
  (perIpPerHour ≤ 60, perDayTotal ≤ 2000, etc.) — the screen can't lift its
  own limits (decision 22).

---

## 8. Storage schema

From `migrations/0004–0008_*.sql`:

| Table | Purpose | Notable columns |
|---|---|---|
| `ai_providers` | provider configs | `api_key` nullable (half-configured = inert, not 401), `assist_model`, `active`, `priority` |
| `ai_settings` (documents row) | singleton config | lives in `documents` under key `ai-assistant` |
| `ai_rate` | both budget buckets | `bucket TEXT PK` (`ip:<hash>:<hourStart>` / `day:<date>`), `hits`, `expires_at` (ms); opportunistic sweep on write |
| `ai_chats` | authoring conversations | browser-generated id, `surface` ∈ journal/project, nullable `doc_slug` |
| `ai_messages` | turns | `role` ∈ user/**assistant**/**note**, `thinking`, `task` label |

---

## 9. Tests that pin the guarantees

`npm run check:ai` (`scripts/test-ai.mjs`) — run in `npm run check`:

- hidden project / draft post never survive corpus or any tool
- contact details absent from corpus and every tool result
- provider listing payloads cannot carry the API key (asserted on serialized JSON)
- `clampParams()` drops unknown keys, clamps ranges
- scope filter: 17 legitimate questions answered, misuse shapes refused
- settings clamp boundaries

Plus `npm run check:worker` (OAuth worker: refresh token never leaves the
Worker, origin allowlist, fail-closed without secret) and
`npm run check:schema` (the column allowlist).
