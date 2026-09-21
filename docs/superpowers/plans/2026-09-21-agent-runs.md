# Agent Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The daily journal post becomes a persisted run of bounded steps that a cron tick or the owner's panel advances and resumes; the tool loop stops re-paying for reasoning and re-sending old lookups; a non-streamed body is bounded; and the veil behind two dialogs stops covering them.

**Architecture:** A pure module (`agent-runs.ts`) owns the run's state machine — plan → one section per request → assemble — and a server module (`agent-runner.ts`) loads a `documents` row, advances it one step through the existing tool loop (`agentComplete` for the cron, `agentStream` for the owner) and saves it. `/api/ai/daily` loops steps until the tick's budget runs out; `/api/ai/runs` streams one step to the panel. `ai.ts` gains reasoning passthrough, rolling result trimming and a bounded body read.

**Tech Stack:** Astro 5 on Cloudflare Workers (`prerender = false` routes), D1, plain `node:assert` tests through `scripts/test-ai.mjs` (Node ≥ 22.18 via fnm), Playwright + Edge for browser checks.

**Spec:** `docs/superpowers/specs/2026-09-21-agent-runs-design.md`

## Global Constraints

- Node lives under fnm: prefix every command with `export PATH="/c/Users/anish.giri.AXCEND/AppData/Roaming/fnm/node-versions/v24.18.0/installation:$PATH"`.
- `npm run check:ai` asserts the key-masking fingerprint against a real `OPENROUTER_API_KEY`; the `.env` has one (dead for network calls, fine for the checks).
- Repo files are CRLF except `src/lib/ai.ts` and files created this month; the Edit tool preserves endings. Python patches must match `\r\n`.
- The Bash tool truncates long commands: write scripts to the scratchpad and run the file.
- Never add AI attribution to commits.
- Every route that reads `Astro.locals.runtime` declares `export const prerender = false` (`check:content` fails the build otherwise).
- No new dependencies. No new tables — a run is a `documents` row `run:journal-post:<day>`.
- Nothing rendered in the panel is parsed as markup: `textContent` only.
- A log row is never written per anonymous request (decision 62); every row here is behind `requireOwner()` or `CRON_SECRET`.
- `journal-auto.ts` imports nothing; `agent-runs.ts` imports only `assist-tasks.ts` and `journal-auto.ts`.

---

### Task 1: The veil is drawn from inside the shell, the form is centred in the free column, tool rows cannot widen the log

**Files:**
- Modify: `src/styles/admin.css:1167-1215` (stepped-down dialog, veil), `src/styles/admin.css:2465-2472` (`.asx-tool-state`)
- Test: a Playwright script in the scratchpad (below)

**Interfaces:**
- Consumes: `body[data-asx-freeze]` and `body[data-asx-dock]` set by `src/lib/modal.ts` / `src/lib/assist-panel.ts` (unchanged); `--admin-sidebar-w` set on `<html>` by `AdminLayout`; `--asx-dock-w` set on `<body>` by the panel.
- Produces: nothing programmatic.

- [ ] **Step 1: Write the browser check that fails today**

Save as `C:\Users\ANISHG~1.AXC\AppData\Local\Temp\claude\d--Misc-Portfolio\0eb7244f-4127-4c3a-ad86-f565e21041bf\scratchpad\veil.mjs`:

```js
// Opens the import form, docks the panel, freezes, and samples the pixels.
// Passes only when the form and the panel are bright under the veil and the
// tool rows do not widen the log.
const { chromium } = require('C:/Users/anish.giri.AXCEND/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1794, height: 940 } });
await page.goto('http://localhost:4321/admin/projects', { waitUntil: 'networkidle' });
await page.evaluate(() => sessionStorage.setItem('om-gh-token', 'x'));
await page.evaluate(async () => {
  const { downgradeOpenModals } = await import('/src/lib/modal.ts');
  const form = document.querySelector('#import-dialog') ?? document.querySelector('dialog.modal');
  form.showModal();
  const panel = document.getElementById('assist-dialog');
  downgradeOpenModals();
  panel.show();
  document.body.dataset.asxDock = 'right';
  document.body.style.setProperty('--asx-dock-w', '496px');
  document.dispatchEvent(new Event('asx-open'));
  const log = document.getElementById('assist-log');
  const row = document.createElement('div');
  row.className = 'asx-tool-row';
  row.innerHTML = '<span class="asx-tool-name">read_repo_docs</span><span class="asx-tool-args">' + 'x'.repeat(300) + '</span><span class="asx-tool-state">' + 'Leptons1618/artifact-report has no README or docs/ to read · 12,345 ms'.repeat(3) + '</span>';
  log.append(row);
});
await page.waitForTimeout(400);
const shot = await page.screenshot({ type: 'png' });
const sharp = (await import('file:///D:/Misc/Portfolio/node_modules/sharp/lib/index.js')).default;
const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const boxes = await page.evaluate(() => {
  const r = s => document.querySelector(s).getBoundingClientRect();
  const log = document.getElementById('assist-log');
  return { form: r('dialog.modal-downgraded[open]'), panel: r('#assist-dialog'), rail: r('.admin-sidebar'), logWide: log.scrollWidth > log.clientWidth + 1 };
});
const bright = ([r, g, b]) => r > 225 && g > 225 && b > 225;
const formPx = px(Math.round(boxes.form.x + 40), Math.round(boxes.form.y + boxes.form.height - 30));
const panelPx = px(Math.round(boxes.panel.x + 30), Math.round(boxes.panel.y + boxes.panel.height - 12));
const pagePx = px(Math.round(boxes.rail.width + 20), 20);
const leftGap = boxes.form.x - (boxes.rail.x + boxes.rail.width);
const rightGap = boxes.panel.x - (boxes.form.x + boxes.form.width);
console.log({ formPx, panelPx, pagePx, leftGap, rightGap, logWide: boxes.logWide });
const ok = bright(formPx) && bright(panelPx) && !bright(pagePx) && Math.abs(leftGap - rightGap) < 24 && !boxes.logWide;
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
```

Wrap it as a CommonJS-with-top-level-await file: name it `veil.mjs` and change the first line to `import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('C:/Users/anish.giri.AXCEND/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');`.

Check the import dialog's real id first: `grep -n '<dialog' src/pages/admin/projects.astro` and use the import form's id in the script.

- [ ] **Step 2: Start the dev server ungated and run the check to see it fail**

```bash
cd /d/Misc/Portfolio && export PATH="/c/Users/anish.giri.AXCEND/AppData/Roaming/fnm/node-versions/v24.18.0/installation:$PATH"
PUBLIC_GITHUB_CLIENT_ID= PUBLIC_GITHUB_OAUTH_WORKER= npx astro dev --port 4321 > "$TEMP/claude/d--Misc-Portfolio/0eb7244f-4127-4c3a-ad86-f565e21041bf/scratchpad/dev.log" 2>&1 &
sleep 8; node "$TEMP/claude/d--Misc-Portfolio/0eb7244f-4127-4c3a-ad86-f565e21041bf/scratchpad/veil.mjs"
```

Expected: `FAIL` with `formPx` and `panelPx` around `[141,142,146]`.

- [ ] **Step 3: Move the veil onto the shell and centre the form**

In `src/styles/admin.css`, replace the veil rule and its comment (the block starting `/* The frozen look behind two coexisting dialogs` through the closing `}` of `body[data-asx-freeze]::after`) with:

```css
/* The frozen look behind two coexisting dialogs, on every admin screen.

   A scrim — the same translucent veil a lone modal gets from its
   `::backdrop` — rather than the `brightness()` filter this used to be: a
   page turned dark grey read as a broken screen, where a veil reads as
   "something is open over this", which is the truth. Set and cleared with
   the `inert` itself, by `syncFreeze()` in `src/lib/modal.ts`, which stamps
   `data-asx-freeze` on `<body>`. Decisions 59, 64 and 65.

   Drawn from `.admin-shell::after`, and it cannot be drawn from `<body>`:
   `theme.css` sets `body > * { position: relative; z-index: 1 }` to lift
   the page above the grain layer, which makes the shell a stacking context
   at z 1 — and a `body::after` at 64 then paints over the *whole* shell,
   the stepped-down dialog (65) and the panel (70) included, because their
   z-indexes are compared inside the shell and never against the veil. That
   is what shipped: form, panel and page all the same grey, only the toast
   bright. A pseudo-element on the shell shares the dialogs' context, so it
   sits over the page, the rail (40) and the route progress (60) and under
   the dialogs. Instant, deliberately: a fade that restarts on every
   recompute reads as flicker. */
body[data-asx-freeze] .admin-shell::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 64;
  background: color-mix(in srgb, var(--color-neutral-900) 45%, transparent);
}
```

Then, directly after the existing `@media (min-width: 621px) { … }` block that shifts `.modal-downgraded[open]` off the dock column, add:

```css
/* And between the rail and the panel, not between the viewport edge and
   the panel. The rail is under the veil while the form is up, but it still
   holds its column, and a form centred across it sat visibly off-centre in
   the room that was actually free. Docked left the panel already sits beside
   the rail, so the reservation is measured from the rail's edge. Below
   861px the rail is a banner across the top and none of this applies. */
@media (min-width: 861px) {
  body[data-asx-dock='right'] .modal-downgraded[open] { left: var(--admin-sidebar-w, 260px); }
  body[data-asx-dock='left'] .modal-downgraded[open] {
    left: calc(var(--admin-sidebar-w, 260px) + var(--asx-dock-w, 608px));
  }
  :root[data-admin-collapsed] body[data-asx-dock='right'] .modal-downgraded[open] { left: 64px; }
  :root[data-admin-collapsed] body[data-asx-dock='left'] .modal-downgraded[open] {
    left: calc(64px + var(--asx-dock-w, 608px));
  }
  body[data-asx-dock] .modal-downgraded[open] {
    max-width: calc(100vw - var(--admin-sidebar-w, 260px) - var(--asx-dock-w, 608px) - var(--space-4) * 2);
  }
  :root[data-admin-collapsed] body[data-asx-dock] .modal-downgraded[open] {
    max-width: calc(100vw - 64px - var(--asx-dock-w, 608px) - var(--space-4) * 2);
  }
}
```

And change `.asx-tool-state` from `flex: none;` to:

```css
.asx-tool-state {
  /* Shrinkable and ellipsised, like the arguments beside it: a long detail
     ("has no README or docs/ to read · 12,345 ms") used to push the row past
     the log and hand the whole transcript a horizontal scrollbar. */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 4: Run the check to see it pass**

Run: `node "$TEMP/claude/d--Misc-Portfolio/0eb7244f-4127-4c3a-ad86-f565e21041bf/scratchpad/veil.mjs"`
Expected: `PASS`, `formPx`/`panelPx` above 225 on every channel, `pagePx` below 200, `logWide: false`.

Also open `http://localhost:4321/admin/journal/new` in the same script style (a second run with the media library: `document.getElementById('media-dialog')?.showModal()` — check the id with `grep -n '<dialog' src/components/*.astro`) and confirm the same three pixel results; the veil is one rule for every screen.

- [ ] **Step 5: Commit**

```bash
git add src/styles/admin.css
git commit -m "fix: the veil behind two dialogs is drawn from the shell, so the dialogs paint over it"
```

---

### Task 2: A non-streamed body is bounded, and the completion's answer round gets a grace instead of no clock

**Files:**
- Modify: `src/lib/ai.ts` — `callProvider()` (~line 760), `answerCall` (~line 2290), `agentComplete()` (~line 2560)
- Test: `scripts/test-ai.mjs` (after the `a completion is never asked for as a stream` check)

**Interfaces:**
- Produces: `answerCall(call, grace = ANSWER_GRACE_MS)` (module-private, signature widened); `callProvider()` returns a buffered `Response` for `stream: false`.

- [ ] **Step 1: Write the failing test**

Append after `await checkAsync('a completion is never asked for as a stream', …)` in `scripts/test-ai.mjs`:

```js
await checkAsync('a non-streamed body that never arrives fails the attempt inside its timeout', async () => {
  /* Decision 65. Row `11:14` in the live log: headers at once, a 460-second
     body, an answer of nothing. The attempt timer used to stop at the
     headers; it now runs to the last byte, so a stalled body is an attempt
     that failed and the walk moves on. */
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.model);
    if (body.model === 'primary') {
      /* Headers now, body never — and the body respects the abort signal the
         way a real fetch does. */
      return new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify(completion({ role: 'assistant', content: 'From the second model.' })), { status: 200 });
  };
  try {
    const started = Date.now();
    const result = await agentComplete({
      providers: [row({ fallbackModels: ['second'] })],
      which: 'assist',
      call: { maxTokens: 100, timeoutMs: 80 },
      messages: [{ role: 'user', content: 'go' }],
      runTool: async () => ({ ok: true, text: 'x', detail: 'x' }),
    });
    assert.deepEqual(sent, ['primary', 'second']);
    assert.equal(result.text, 'From the second model.');
    assert.ok(Date.now() - started < 2_000, 'the stalled body was not cut off by the attempt timer');
  } finally {
    globalThis.fetch = real;
  }
});

await checkAsync('a completion’s answer round gets one attempt of grace, not the expired lookup clock', async () => {
  /* The lookups may spend the deadline; the round that answers from them
     must still be allowed to start — the streamed loop's `answerCall()`
     rule, here with a grace of one full attempt. */
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(init.body);
    sent.push({ tools: Boolean(body.tools), n: sent.length });
    return new Response(
      JSON.stringify(sent.length === 1
        ? completion(asksFor('c1', 'read_post', '{"slug":"live"}'))
        : completion({ role: 'assistant', content: 'TITLE: Answered from the lookup.' })),
      { status: 200 },
    );
  };
  try {
    const result = await agentComplete({
      providers: [row({})],
      which: 'assist',
      call: { maxTokens: 100, tools: toolsFor('assist'), timeoutMs: 5_000, deadline: Date.now() + 5 },
      messages: [{ role: 'user', content: 'go' }],
      runTool: async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { ok: true, text: 'the post', detail: 'ok' };
      },
    });
    assert.equal(sent.length, 2, 'the answer round was refused for lack of time');
    assert.equal(sent[1].tools, false, 'the answer round still offered tools');
    assert.match(result.text, /Answered from the lookup/);
  } finally {
    globalThis.fetch = real;
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run check:ai 2>&1 | grep -E "FAIL|checks passed"`
Expected: the first new check FAILs (hangs are bounded by the test's own timeout? No — a hang would never end; if the run does not finish inside a minute, `Ctrl-C` and treat that as the failure: the stalled body is not bounded today). The second FAILs with `sent.length` 1 or an out-of-time error.

- [ ] **Step 3: Bound the body read in `callProvider`, widen `answerCall`, use both in `agentComplete`**

In `callProvider`, replace the `try { return await fetch(…) }` body so the non-streamed body is read under the same timer:

```ts
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      /* …the existing method, headers and body, unchanged… */
      signal: controller.signal,
    });
    if (options.stream || !response.body) return response;
    /* A non-streamed answer is one body that arrives when the model is done,
       and the timer above used to stop at the headers: OpenRouter sends them
       at once and the body minutes later, so a vendor that deliberated for
       eight minutes was an attempt that never timed out. Read here, under the
       same clock, and handed on as a buffered response; an attempt is now
       bounded from its first byte to its last. Raced against the signal as
       well as relying on it, so a body stream that ignores the abort cannot
       pin the run either. Decision 65. */
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    ]);
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
```

Change `answerCall` to take the grace:

```ts
const answerCall = (
  call: Omit<CallOptions, 'messages'>,
  grace = ANSWER_GRACE_MS,
): Omit<CallOptions, 'messages'> =>
  call.deadline === undefined ? call : { ...call, deadline: Date.now() + grace };
```

In `agentComplete`, replace the round's call:

```ts
    const armed = Boolean(call.tools?.length);
    /* The answer round on its own clock — one full attempt of grace, since a
       non-streamed post needs its headers *and* its body inside the attempt.
       It used to go out with no deadline at all, which the bounded body read
       in `callProvider` makes unnecessary and the walk across fallbacks made
       unwise. */
    const round = armed ? call : answerCall(call, Math.max(ANSWER_GRACE_MS, call.timeoutMs ?? 0));
    const { response, provider } = await callChat(candidates, { ...round, messages }, which);
```

and delete the old `...(armed ? {} : { deadline: undefined })`. Update the function's doc comment: replace the paragraph beginning "The answer round is sent **without a deadline**" with "The answer round is sent on its own clock — one attempt of grace — because `callProvider` now bounds a non-streamed body end to end; see decision 65."

- [ ] **Step 4: Run the tests**

Run: `npm run check:ai 2>&1 | grep -E "FAIL|checks passed"`
Expected: `ai: 202 checks passed` (two more than before), no FAIL. Then `npx astro check 2>&1 | tail -3` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai.ts scripts/test-ai.mjs
git commit -m "fix: a non-streamed body is read under the attempt timer, and the completion's answer round gets a grace"
```

---

### Task 3: Earlier rounds' tool results are trimmed before the next round is sent

**Files:**
- Modify: `src/lib/ai.ts` — new `compactResults()` beside `toolCallsFor` (~line 2300); `nextRound()` callers in `agentLines` (3 sites) and the `callChat` in `agentComplete`
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Produces: `export function compactResults(messages: ChatMessage[], keep = 1): ChatMessage[]`, `export const TRIM_CHARS = 600`.

- [ ] **Step 1: Write the failing test**

Add `compactResults, TRIM_CHARS,` to the destructured import from `src/lib/ai.ts` at the top of `scripts/test-ai.mjs`. Append near the other tool-loop checks:

```js
check('results from earlier rounds are trimmed before the next round goes out', () => {
  const big = 'r'.repeat(2_000);
  const turn = (id) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read_post', arguments: '{}' } }] });
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'go' },
    turn('a'), { role: 'tool', tool_call_id: 'a', name: 'read_post', content: big },
    turn('b'), { role: 'tool', tool_call_id: 'b', name: 'read_post', content: big },
    turn('c'), { role: 'tool', tool_call_id: 'c', name: 'read_post', content: big },
  ];
  const out = compactResults(messages);
  assert.equal(out.length, messages.length);
  assert.ok(out[3].content.endsWith('[trimmed: already read]'), 'the first round kept its whole result');
  assert.ok(out[3].content.length <= TRIM_CHARS + 30);
  assert.ok(out[5].content.endsWith('[trimmed: already read]'), 'the second round kept its whole result');
  assert.equal(out[7].content, big, 'the latest round was trimmed');
  assert.equal(messages[3].content, big, 'the caller’s list was mutated');
  /* A short result is left alone, and a run with one round is unchanged. */
  const one = [messages[0], messages[1], turn('a'), { role: 'tool', tool_call_id: 'a', name: 'read_post', content: 'short' }];
  assert.deepEqual(compactResults(one), one);
  assert.deepEqual(compactResults([messages[0], messages[1]]), [messages[0], messages[1]]);
});

await checkAsync('the third request of a run carries the first round’s result trimmed', async () => {
  const bodies = [];
  let round = 0;
  const big = 'x'.repeat(3_000);
  const real = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    bodies.push(JSON.parse(init.body));
    round += 1;
    return new Response(
      sse(round === 1
        ? [wantsTool('c2', 'read_post', '{"slug":"two"}')]
        : [text('Done.'), { choices: [{ finish_reason: 'stop' }] }]),
      { status: 200 },
    );
  };
  try {
    const stream = agentStream({
      first: { response: new Response(sse([wantsTool('c1', 'read_post', '{"slug":"one"}')])), provider: row({}) },
      which: 'chat',
      call: { maxTokens: 100, tools: toolsFor('chat') },
      messages: [{ role: 'user', content: 'go' }],
      runTool: async () => ({ ok: true, text: big, detail: 'ok' }),
    });
    await new Response(stream).text();
    assert.equal(bodies.length, 2, 'two follow-up requests');
    const second = bodies[1].messages.filter(m => m.role === 'tool');
    assert.equal(second.length, 2);
    assert.ok(second[0].content.endsWith('[trimmed: already read]'), 'round one’s result went out whole again');
    assert.equal(second[1].content, big, 'round two’s result was trimmed on the round that asked for it');
  } finally {
    globalThis.fetch = real;
  }
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run check:ai 2>&1 | grep -E "FAIL|checks passed"`
Expected: `compactResults is not a function` (or the import is `undefined`).

- [ ] **Step 3: Implement**

In `src/lib/ai.ts`, after `toolCallsFor`:

```ts
/** What an earlier round's tool result is cut to before the next request. */
export const TRIM_CHARS = 600;

/**
 * The conversation with earlier rounds' lookups trimmed.
 *
 * Every round used to re-send every result in full: three reads at 8,000
 * characters was 24,000 characters on each later request, on a task whose
 * whole ceiling is 4,000 tokens. A result is read in full on the round that
 * asked for it; by the next round the model has taken what it needed into
 * its own reasoning and its next call, so the rounds before the last `keep`
 * are cut to their opening and say so. The caller's list is not touched —
 * the loop keeps the whole transcript and sends the trimmed one. Decision 65.
 */
export function compactResults(messages: ChatMessage[], keep = 1): ChatMessage[] {
  const turns = messages.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
  let seen = 0;
  return messages.map(message => {
    if (message.role === 'assistant' && message.tool_calls?.length) seen += 1;
    if (message.role !== 'tool' || seen > turns - keep || message.content.length <= TRIM_CHARS) return message;
    return { ...message, content: `${message.content.slice(0, TRIM_CHARS).trimEnd()}\n[trimmed: already read]` };
  });
}
```

In `agentLines`, every `nextRound(messages, …)` call becomes `nextRound(compactResults(messages), …)` (three sites: the nudge, the limit branch, the end of the round). In `agentComplete`, `{ ...round, messages }` becomes `{ ...round, messages: compactResults(messages) }`.

- [ ] **Step 4: Run the tests**

Run: `npm run check:ai 2>&1 | grep -E "FAIL|checks passed"` → `ai: 204 checks passed`. `npx astro check 2>&1 | tail -3` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai.ts scripts/test-ai.mjs
git commit -m "feat: earlier rounds' lookup results are trimmed before the next round is sent"
```

---

### Task 4: A vendor's reasoning is handed back on the tool-call turn

**Files:**
- Modify: `src/lib/ai.ts` — `ChatMessage` (~line 520), `SseEvent` + `sseEvents()` (~lines 1480–1760), `agentLines` (the two `messages.push({ role: 'assistant' … tool_calls` sites), `agentComplete` (the `messages.push({ role: 'assistant', content, tool_calls` site)
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Produces: `ChatMessage.reasoning_details?: unknown[]`, `ChatMessage.reasoning_content?: string`; a module-private `SseEvent` kind `carry`.

- [ ] **Step 1: Write the failing tests**

```js
await checkAsync('reasoning a vendor sent comes back on the assistant turn that carries the tool calls', async () => {
  /* OpenRouter's interleaved-thinking contract: `reasoning_details` back
     unmodified, or the model deliberates the whole task again every round.
     DeepSeek's is `reasoning_content`. Only ever echoed — a run whose
     answers carried neither sends neither. Decision 65. */
  const bodies = [];
  let round = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    bodies.push(JSON.parse(init.body));
    round += 1;
    return new Response(sse([text('Done.'), { choices: [{ finish_reason: 'stop' }] }]), { status: 200 });
  };
  const detail = (textPart, index = 0) => ({ choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: textPart, index }] } }] });
  try {
    const stream = agentStream({
      first: {
        response: new Response(sse([
          detail('Let me '), detail('read it.'),
          { choices: [{ delta: { reasoning_content: 'plain reasoning' } }] },
          wantsTool('c1', 'read_post', '{"slug":"one"}'),
        ])),
        provider: row({}),
      },
      which: 'chat',
      call: { maxTokens: 100, tools: toolsFor('chat') },
      messages: [{ role: 'user', content: 'go' }],
      runTool: async () => ({ ok: true, text: 'the post', detail: 'ok' }),
    });
    await new Response(stream).text();
    const turn = bodies[0].messages.find(m => m.role === 'assistant' && m.tool_calls);
    assert.ok(turn, 'no assistant turn with tool calls was sent');
    assert.deepEqual(turn.reasoning_details, [{ type: 'reasoning.text', text: 'Let me read it.', index: 0 }]);
    assert.equal(turn.reasoning_content, 'plain reasoning');
  } finally {
    globalThis.fetch = real;
  }

  /* Neither field arrived: neither goes back. */
  const { frames } = await runAgent([[wantsTool('c1', 'read_post', '{"slug":"one"}')], [text('ok'), { choices: [{ finish_reason: 'stop' }] }]]);
  assert.ok(frames.some(f => f.done));
});

await checkAsync('a completion echoes reasoning fields only when the body carried them', async () => {
  const withReasoning = await runComplete([
    { choices: [{ message: { ...asksFor('c1', 'read_post', '{"slug":"live"}'), reasoning_details: [{ type: 'reasoning.text', text: 'hm' }], reasoning_content: 'hm' }, finish_reason: 'tool_calls' }] },
    completion({ role: 'assistant', content: 'Done.' }),
  ]);
  const turn = withReasoning.sent[1].messages.find(m => m.role === 'assistant' && m.tool_calls);
  assert.deepEqual(turn.reasoning_details, [{ type: 'reasoning.text', text: 'hm' }]);
  assert.equal(turn.reasoning_content, 'hm');

  const without = await runComplete([
    completion(asksFor('c1', 'read_post', '{"slug":"live"}')),
    completion({ role: 'assistant', content: 'Done.' }),
  ]);
  const plain = without.sent[1].messages.find(m => m.role === 'assistant' && m.tool_calls);
  assert.equal('reasoning_details' in plain, false);
  assert.equal('reasoning_content' in plain, false);
});
```

For the streamed no-reasoning half, add to the first test after the `runAgent` line: capture bodies with the same fetch-stub pattern and assert `!('reasoning_details' in turn)` — copy the stub, feed `[wantsTool(...)]` as the first round, and assert the assistant turn has neither key.

- [ ] **Step 2: Run to see it fail**

Run: `npm run check:ai 2>&1 | grep -E "FAIL|checks passed"` → the first two new checks FAIL on `turn.reasoning_details` being `undefined`.

- [ ] **Step 3: Implement**

`ChatMessage` gains, after `tool_calls`:

```ts
  /**
   * `assistant` only: the reasoning a vendor sent with this turn, handed back
   * so the next round continues the same deliberation instead of starting it
   * again. OpenRouter's `reasoning_details` array verbatim; DeepSeek's
   * `reasoning_content` string. Set only from what a response carried — a
   * vendor that never sent the field is never sent it. Decision 65.
   */
  reasoning_details?: unknown[];
  reasoning_content?: string;
```

`SseEvent` gains:

```ts
  /** The reasoning fields to hand back with this round's tool calls, when any arrived. */
  | { kind: 'carry'; reasoning_details?: unknown[]; reasoning_content?: string };
```

`frameFor` returns `null` for it (the `default` branch already does). In `sseEvents`, beside `const calls = new Map…`:

```ts
  /* Reasoning as the vendor wants it back — `reasoning_details` entries
     merged by their `index` (text arrives a fragment at a time), and the
     plain `reasoning_content` string. Yielded once at the end of the round;
     `agentLines` puts them on the assistant turn. */
  const details = new Map<number, Record<string, unknown>>();
  let reasoningContent = '';
```

In the frame loop, after the tool-call fragments are accumulated:

```ts
        for (const [at, entry] of (choice?.delta?.reasoning_details ?? []).entries()) {
          if (!entry || typeof entry !== 'object') continue;
          const item = entry as Record<string, unknown>;
          const index = typeof item.index === 'number' ? item.index : at;
          const held = details.get(index);
          if (!held) {
            details.set(index, { ...item });
            continue;
          }
          for (const key of ['text', 'summary', 'data'] as const) {
            if (typeof item[key] === 'string') held[key] = `${typeof held[key] === 'string' ? held[key] : ''}${item[key]}`;
          }
        }
        if (typeof choice?.delta?.reasoning_content === 'string') reasoningContent += choice.delta.reasoning_content;
```

Extend the `parsed` type's `delta` with `reasoning_details?: unknown[]`. A chunk that carries `reasoning_details` text but neither `reasoning` nor `reasoning_content` is still thinking to *show*: where `separated` is computed, fall back to the chunk's `reasoning_details` `text` fragments joined (`(choice?.delta?.reasoning_details ?? []).map(d => typeof (d as { text?: unknown })?.text === 'string' ? (d as { text: string }).text : '').join('')`) only when both named fields are absent, so a vendor that sends all three is not shown its thinking twice. Before `const asked = […calls.values()]…` at the end of the round:

```ts
    if (details.size || reasoningContent) {
      yield {
        kind: 'carry',
        ...(details.size ? { reasoning_details: [...details.values()] } : {}),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      };
    }
```

In `agentLines`, per round declare `let carry: Pick<ChatMessage, 'reasoning_details' | 'reasoning_content'> = {};`, handle the event:

```ts
      if (event.kind === 'carry') {
        const { kind, ...fields } = event;
        carry = fields;
        continue;
      }
```

and spread it into both `messages.push({ role: 'assistant', content: said, tool_calls: toolCallsFor(asked), ...carry })` sites (the limit branch and the normal one). Leave the nudge's `messages.push({ role: 'assistant', content: said })` alone.

In `agentComplete`, extend the body type's `message` with `reasoning_details?: unknown[]`, and:

```ts
    const carry: Pick<ChatMessage, 'reasoning_details' | 'reasoning_content'> = {
      ...(Array.isArray(message.reasoning_details) && message.reasoning_details.length
        ? { reasoning_details: message.reasoning_details }
        : {}),
      ...(typeof message.reasoning_content === 'string' && message.reasoning_content
        ? { reasoning_content: message.reasoning_content }
        : {}),
    };
    …
    messages.push({ role: 'assistant', content, tool_calls: toolCallsFor(asked), ...carry });
```

`wireMessages` spreads the message, so both fields travel; nothing to change there.

- [ ] **Step 4: Run the tests**

`npm run check:ai 2>&1 | grep -E "FAIL|checks passed"` → `ai: 206 checks passed`. `npx astro check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai.ts scripts/test-ai.mjs
git commit -m "feat: reasoning a vendor sent is handed back on the turn that carries the tool calls"
```

---

### Task 5: Two step tasks for the journal, and `parsePlan` takes its minimum and its fallback

**Files:**
- Modify: `src/lib/assist-tasks.ts` — `parsePlan()` (~line 1809), `ASSIST_TASKS` (add two entries after `casestudysection`), `RoutableTask` (~line 1296)
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Produces: `parsePlan(text, options?: { min?: number; fallback?: readonly PlannedSection[] })`; `ASSIST_TASKS.journalplan`, `ASSIST_TASKS.journalsection` (`step: true`).

- [ ] **Step 1: Write the failing tests**

```js
check('parsePlan takes its own minimum and fallback, and the case study is unchanged', () => {
  const two = 'FACTS:\n- one\n- two\nSECTIONS:\n## A\nbrief\n## B\nbrief';
  const fallback = [{ heading: 'X', brief: 'x' }, { heading: 'Y', brief: 'y' }, { heading: 'Z', brief: 'z' }];
  const asCase = parsePlan(two);
  assert.equal(asCase.planned, false);
  assert.equal(asCase.sections[0].heading, DEFAULT_SECTIONS[0].heading);
  const asPost = parsePlan(two, { min: 3, fallback });
  assert.equal(asPost.planned, false);
  assert.deepEqual(asPost.sections.map(s => s.heading), ['X', 'Y', 'Z']);
  assert.deepEqual(asPost.facts, ['one', 'two']);
  const three = `${two}\n## C\nbrief`;
  assert.equal(parsePlan(three, { min: 3 }).planned, true);
  assert.equal(parsePlan(three).planned, false);
});

check('the journal’s two steps are closed table entries like the case study’s', () => {
  const plan = ASSIST_TASKS.journalplan;
  assert.equal(plan.step, true);
  assert.equal(plan.command, undefined);
  assert.equal(plan.surface, 'journal');
  assert.equal(plan.format, 'document');
  assert.deepEqual(plan.keys.head.map(k => k.label), ['TITLE', 'SUMMARY', 'TAGS', 'ANGLE']);
  assert.equal(plan.keys.tail.label, 'FACTS');
  assert.equal(plan.needsCorpus, true);
  assert.match(plan.instructions, /NOTHING:/);
  const section = ASSIST_TASKS.journalsection;
  assert.equal(section.step, true);
  assert.equal(section.needsCorpus, false);
  for (const key of ['title', 'summary', 'facts', 'outline', 'section', 'previous']) {
    assert.ok(section.context.includes(key), `${key} is not sent to the section step`);
  }
  assert.ok(section.maxTokens >= 1200);
  /* Not on any menu, not typable, not a spoken route. */
  assert.equal(ASSIST_MENU.some(item => item.name === 'journalplan' || item.name === 'journalsection'), false);
  assert.equal(pickTask('plan the journal entry', 'journal'), null);
});
```

`PLAN_KEYS` lives in `agent-runs.ts` (Task 7); here the task carries its own shape literal, asserted by label.

- [ ] **Step 2: Run to see it fail** — `ASSIST_TASKS.journalplan` is `undefined`; the `parsePlan` check fails on `asPost.sections`.

- [ ] **Step 3: Implement**

`parsePlan`:

```ts
export function parsePlan(
  text: string,
  options: { min?: number; fallback?: readonly PlannedSection[] } = {},
): CaseStudyPlan {
  const min = options.min ?? 4;
  const fallback = options.fallback ?? DEFAULT_SECTIONS;
  /* …the body is unchanged down to… */
  const usable = unique.length >= min;
  return {
    facts: facts.slice(0, 40),
    sections: (usable ? unique : fallback.map(section => ({ ...section }))).slice(0, 9),
    planned: usable,
  };
}
```

Update its doc comment's last sentence: "fewer than `min` sections (four for the case study) is not a plan, so `fallback` stands in and `planned` says so."

Add the two tasks after `casestudysection`:

```ts
  /**
   * The daily journal entry, step one: decide what it is about and plan it.
   *
   * The one-request `compose` could not survive the free pool on a schedule
   * (decision 65), so the daily post is written the way the long case study
   * is: a plan that reads and decides, then one request per section. This is
   * the plan, and it is also the decision — `ANGLE` is the model saying which
   * one specific thing today's entry is about, and `NOTHING:` is it declining
   * the day. `agent-runs.ts` reads the answer; `journalsection` writes from it.
   */
  journalplan: {
    label: 'Plan the journal entry',
    surface: 'journal',
    group: 'write',
    step: true,
    hint: 'Decides what today’s entry is about, reads for the facts, and plans its sections.',
    instructions: `Decide what today's journal entry is about, gather what it will say, and plan its sections. You are not writing the entry yet.

Work from the index and the steer below. Read one or two of the pages the entry will draw on — read_project or read_case_study for the work itself, read_post to see what an existing entry already covered — and no more than three lookups in all. Then answer.

If every subject in the index already has an entry that covers it and there is nothing specific left to write, answer with exactly one line — NOTHING: followed by the reason — and nothing else.

Otherwise return exactly this shape, each label at the start of its own line:

TITLE: the entry's title, plain text, no quotes
SUMMARY: one sentence under 160 characters, for the card
TAGS: three to six comma-separated tags in Title Case
ANGLE: one or two sentences naming the one specific thing this entry is about, and why it is worth an entry
FACTS:
- one specific, checkable fact per line, ten to twenty-five of them, every one from the index or the pages you read: the actual module, function, command, number, file, failure or decision
SECTIONS:
## First section heading
One sentence: what this section covers and which facts it draws on.
## Second section heading
...

Rules:
- Three to six sections. A heading says what happened in plain words — never "Introduction", "Background" or "Conclusion".
- Plan the entry as a first-person account of work that was done: what was tried, what broke, what it cost, what is still open. One section carries the entry's one code block, and its brief says which fact holds the code or command.
- Invent nothing. If the pages give no figure for something, plan the sentence without one.
- Emit nothing before TITLE: (or NOTHING:) and nothing after the last section. Do not wrap the response in a code fence.`,
    format: 'document',
    keys: {
      head: [
        { key: 'title', label: 'TITLE' },
        { key: 'summary', label: 'SUMMARY' },
        { key: 'tags', label: 'TAGS' },
        { key: 'angle', label: 'ANGLE' },
      ],
      tail: { key: 'facts', label: 'FACTS' },
    },
    maxTokens: 2400,
    temperature: 0.5,
    needsCorpus: true,
    context: [],
  },

  /**
   * The daily journal entry, step two: one section, from the plan.
   *
   * `casestudysection`'s shape with the journal's voice — first person, past
   * tense, the decision and what it cost. No lookups: the plan's facts are
   * the whole of what it may say, which keeps every request short and every
   * claim traceable to a page that was read.
   */
  journalsection: {
    label: 'Write one journal section',
    surface: 'journal',
    group: 'write',
    step: true,
    hint: 'One section of today’s entry, from the plan.',
    instructions: `Write one section of a journal entry, the one named under "The section to write now". The other sections are written separately.

Rules:
- The first line is that section's level-2 heading, exactly as given. Then the section, and nothing else — not the next section, no closing summary.
- The length given with the section, give or take fifty words.
- First person, past tense, about work the author actually did: "I", a specific week, the decision and what it cost. Never address the reader as "you", never write "we" for one person's work, and never explain the subject the way a tutorial would. If someone who was not there could have written a paragraph, cut it.
- Build the section from the facts and nothing else. Name the actual module, function, file, command, number and trade-off. Where the facts are thin, go deeper on what they say rather than padding.
- Inline code for every identifier, filename, flag, command, column, table and setting. A fenced code block with a language tag only where the facts contain the code or command itself, and never longer than fifteen lines.
- Continue from the previous section. Do not re-introduce the subject, and do not repeat a point the outline gives to another section.
- Link to this site's pages by path — /projects/example, /journal/example — only where the facts name the slug.
- Markdown only. No preamble, and do not wrap the response in a code fence.`,
    format: 'markdown',
    maxTokens: 1200,
    temperature: 0.65,
    needsCorpus: false,
    context: ['title', 'summary', 'facts', 'outline', 'section', 'previous'],
  },
```

`RoutableTask` becomes `Exclude<AssistTaskName, 'chat' | 'casestudyplan' | 'casestudysection' | 'journalplan' | 'journalsection'>`.

Update the file's header count ("The eighteen things…") to twenty, and the sentence in `.claude/rules/ai-assistant.md` is handled in Task 11.

- [ ] **Step 4: Run the tests** — `ai: 208 checks passed`; `npx astro check` 0 errors (the `satisfies` catches a malformed entry).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist-tasks.ts scripts/test-ai.mjs
git commit -m "feat: the journal's plan and section steps, and parsePlan takes its minimum and fallback"
```

---

### Task 6: The run record can say the day was declined

**Files:**
- Modify: `src/lib/journal-auto.ts` — `AutoJournalRun`, `EMPTY_RUN`, `clampAutoRun`, `decide()`
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Produces: `AutoJournalRun.declined: boolean`; `decide()` answers `act: false` with reason `Nothing to write today: <note>` when set.

- [ ] **Step 1: Write the failing test**

```js
check('a declined day is not retried', () => {
  const settings = clampAutoSettings({ enabled: true, windowStart: 0, windowEnd: 24 });
  const at = new Date('2026-09-21T23:00:00Z');
  const declined = clampAutoRun({ day: '2026-09-21', attempts: 0, slug: '', note: 'every subject is covered', at: at.toISOString(), declined: true });
  assert.equal(declined.declined, true);
  const verdict = decide(at, settings, declined);
  assert.equal(verdict.act, false);
  assert.match(verdict.reason, /Nothing to write today: every subject is covered/);
  /* Tomorrow is a new day. */
  assert.equal(decide(new Date('2026-09-22T23:00:00Z'), settings, declined).act, true);
  assert.equal(clampAutoRun({}).declined, false);
  assert.equal(EMPTY_RUN.declined, false);
});
```

- [ ] **Step 2: Run to see it fail** — `declined` is `undefined`.

- [ ] **Step 3: Implement**

```ts
export interface AutoJournalRun {
  day: string;
  /** Failed steps on that day — what `maxAttempts` bounds. Decision 65. */
  attempts: number;
  slug: string;
  note: string;
  at: string;
  /**
   * The model declined the day: nothing specific was left to write. A
   * decision rather than a failure, so the schedule does not retry it — the
   * next tick would ask the same question of the same index.
   */
  declined: boolean;
}

export const EMPTY_RUN: AutoJournalRun = { day: '', attempts: 0, slug: '', note: '', at: '', declined: false };
```

In `clampAutoRun` add `declined: source.declined === true,`. In `decide()`, after the `today.slug` check:

```ts
  if (today.declined) {
    return { act: false, day, reason: `Nothing to write today: ${today.note}` };
  }
```

- [ ] **Step 4: Run the tests** — `ai: 209 checks passed`; `astro check` 0 errors (the `daily.ts` `writeRun` calls pass whole objects spread from `today`, which now carries `declined`; the `{ day, attempts, slug, note, at }` literal in the success path fails the typecheck — add `declined: false` there for now; Task 8 replaces the route).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journal-auto.ts src/pages/api/ai/daily.ts scripts/test-ai.mjs
git commit -m "feat: the daily run record can say the day was declined, and the schedule does not retry it"
```

---

### Task 7: `agent-runs.ts` — the run as pure state

**Files:**
- Create: `src/lib/agent-runs.ts`
- Test: `scripts/test-ai.mjs` (new section 15 at the end, before the final `checks passed` line)

**Interfaces:**
- Consumes: `parseFields`, `parsePlan`, `cleanSection`, `sectionContext`, `sectionWords`, `PlannedSection`, `FieldShape`, `AssistTaskName` from `assist-tasks.ts`; `autoInstruction`, `AutoJournalSettings` from `journal-auto.ts`.
- Produces (all exported):
  - `RUN_KIND = 'journal-post'`, `runSlug(day): string`, `POST_WORDS = 950`, `LOCK_MS = 240_000`, `TRAIL_CAP = 40`, `POST_SECTIONS`, `PLAN_KEYS`
  - types `RunPhase`, `PostPlan`, `StepRecord`, `RunLock`, `PostRun`, `RunStep`, `StepMeta`, `StepFrame`, `RunSummary`
  - `newRun(day, topic, now?)`, `clampRun(raw): PostRun | null`, `nextStep(run, settings): RunStep | null`, `applyStep(run, step, text, meta, settings): PostRun`, `failStep(run, step, reason, meta, settings): PostRun`, `assemblePost(run)`, `summariseRun(run, now?)`, `holdLock(run, by, now?): PostRun | null`, `releaseLock(run)`, `isTerminal(run)`

- [ ] **Step 1: Write the failing tests**

Add the module to the loads at the top of `scripts/test-ai.mjs`:

```js
const {
  RUN_KIND, LOCK_MS, POST_SECTIONS, PLAN_KEYS, runSlug,
  newRun, clampRun, nextStep, applyStep, failStep, assemblePost, summariseRun, holdLock, releaseLock, isTerminal,
} = await load('src/lib/agent-runs.ts');
```

Append before `process.stdout.write(\`\nai: ${checks} checks passed\n\`)`:

```js
/* ---------- 15. a run of steps ---------- */

const runSettings = clampAutoSettings({ enabled: true, maxAttempts: 2, instruction: 'Keep it short.' });
const meta = { model: 'Provider · primary', ms: 1234, now: new Date('2026-09-21T10:00:00Z') };
const GOOD_PLAN = `TITLE: The cache I added to the copilot
SUMMARY: One week of adding an LRU cache and what it cost.
TAGS: Caching, Performance, Copilot
ANGLE: The cache halved p95 but doubled the memory ceiling, and the trade-off is the entry.
FACTS:
- lru_cache is capped at 1000 entries
- p95 latency went from 900 ms to 420 ms
- memory doubled to 1.2 GB
SECTIONS:
## What the copilot was waiting on
The latency before, and the profile that named the cache miss.
## Adding the cache
The lru_cache line and the size limit.
## What it cost
Memory, and the eviction storm.
## What is still open
The eviction policy.`;

check('a run walks plan → sections → finish → nothing', () => {
  const run = newRun('2026-09-21', 'caching', meta.now);
  assert.equal(run.phase, 'plan');
  assert.equal(runSlug(run.key), 'run:journal-post:2026-09-21');
  const plan = nextStep(run, runSettings);
  assert.equal(plan.id, 'plan');
  assert.equal(plan.task, 'journalplan');
  assert.equal(plan.lookups, true);
  assert.match(plan.instruction, /first person/i);
  assert.match(plan.instruction, /Keep it short\./);

  const planned = applyStep(run, plan, GOOD_PLAN, meta, runSettings);
  assert.equal(planned.phase, 'write');
  assert.equal(planned.plan.title, 'The cache I added to the copilot');
  assert.deepEqual(planned.plan.tags, ['Caching', 'Performance', 'Copilot']);
  assert.equal(planned.plan.sections.length, 4);
  assert.equal(planned.plan.facts.length, 3);
  assert.equal(planned.trail.length, 1);
  assert.equal(planned.trail[0].ok, true);
  assert.match(planned.trail[0].note, /halved p95/);
  assert.equal(planned.failures, 0);

  const first = nextStep(planned, runSettings);
  assert.equal(first.id, 'section:1');
  assert.equal(first.task, 'journalsection');
  assert.equal(first.lookups, false);
  assert.match(first.label, /^Section 1 of 4: What the copilot was waiting on/);
  assert.match(first.context.section, /^## What the copilot was waiting on/);
  assert.match(first.context.facts, /lru_cache/);
  assert.equal(first.context.previous, '');
  assert.equal(first.context.title, planned.plan.title);
  assert.equal(first.instruction, 'Keep it short.');

  let state = planned;
  for (let i = 1; i <= 4; i += 1) {
    const step = nextStep(state, runSettings);
    assert.equal(step.id, `section:${i}`);
    state = applyStep(state, step, `## ${state.plan.sections[i - 1].heading}\n\nI did the thing ${i}. It cost ${i} hours.`, meta, runSettings);
  }
  assert.equal(state.sections.length, 4);
  assert.equal(state.phase, 'finish');
  assert.match(nextStep(state, runSettings).id, /^finish$/);
  assert.equal(nextStep(state, runSettings).task, null);
  const post = assemblePost(state);
  assert.equal(post.title, 'The cache I added to the copilot');
  assert.match(post.body, /^## What the copilot was waiting on/);
  assert.equal((post.body.match(/^## /gm) ?? []).length, 4);
  assert.equal(post.readTime, '1 min');
  assert.equal(post.summary, 'One week of adding an LRU cache and what it cost.');
  const done = { ...state, phase: 'done', slug: 'the-cache' };
  assert.equal(nextStep(done, runSettings), null);
  assert.equal(isTerminal(done), true);
  assert.equal(isTerminal(state), false);
});

check('a resumed run asks for the section after the ones it has', () => {
  const run = applyStep(newRun('2026-09-21', '', meta.now), nextStep(newRun('2026-09-21', '', meta.now), runSettings), GOOD_PLAN, meta, runSettings);
  const resumed = { ...run, sections: ['## a\n\nx', '## b\n\ny', '## c\n\nz'] };
  const step = nextStep(resumed, runSettings);
  assert.equal(step.id, 'section:4');
  assert.match(step.context.previous, /z$/);
});

check('a bad plan answer counts a failure and keeps the phase; enough of them fail the run', () => {
  const run = newRun('2026-09-21', '', meta.now);
  const step = nextStep(run, runSettings);
  const noTitle = applyStep(run, step, 'SUMMARY: only\nFACTS:\n- x\nSECTIONS:\n## a\n## b\n## c', meta, runSettings);
  assert.equal(noTitle.phase, 'plan');
  assert.equal(noTitle.failures, 1);
  assert.match(noTitle.error, /no title/i);
  assert.equal(noTitle.trail[0].ok, false);
  const prose = applyStep(noTitle, step, 'Here is what I think about caching in general.', meta, runSettings);
  assert.equal(prose.failures, 2);
  assert.equal(prose.phase, 'failed', 'maxAttempts (2) failures did not fail the run');
  assert.equal(isTerminal(prose), true);
  /* Two sections but facts: the journal's default arc stands in. */
  const thin = applyStep(run, step, 'TITLE: t\nSUMMARY: s\nTAGS: a, b\nANGLE: because\nFACTS:\n- one fact\nSECTIONS:\n## only\n## two', meta, runSettings);
  assert.equal(thin.phase, 'write');
  assert.deepEqual(thin.plan.sections.map(s => s.heading), POST_SECTIONS.map(s => s.heading));
  /* No facts and no sections: unusable. */
  const empty = applyStep(run, step, 'TITLE: t\nSUMMARY: s\nTAGS: a\nANGLE: x\nFACTS:\n', meta, runSettings);
  assert.equal(empty.phase, 'plan');
  assert.equal(empty.failures, 1);
});

check('the model may decline the day, and an empty section is a failed step', () => {
  const run = newRun('2026-09-21', '', meta.now);
  const declined = applyStep(run, nextStep(run, runSettings), 'NOTHING: every project already has an entry this month.', meta, runSettings);
  assert.equal(declined.phase, 'declined');
  assert.match(declined.error, /every project already has an entry/);
  assert.equal(declined.failures, 0);
  assert.equal(isTerminal(declined), true);

  const planned = applyStep(run, nextStep(run, runSettings), GOOD_PLAN, meta, runSettings);
  const step = nextStep(planned, runSettings);
  const blank = applyStep(planned, step, "Let's draft: Draft:", meta, runSettings);
  assert.equal(blank.sections.length, 0);
  assert.equal(blank.failures, 1);
  assert.equal(blank.phase, 'write');
  const failed = failStep(planned, step, 'Provider refused (429).', meta, runSettings);
  assert.equal(failed.failures, 1);
  assert.equal(failed.error, 'Provider refused (429).');
  assert.equal(failed.trail[failed.trail.length - 1].note, 'Provider refused (429).');
});

check('a run row is re-derived on read, and its summary carries no facts or sections', () => {
  assert.equal(clampRun(null), null);
  assert.equal(clampRun({ kind: 'other', key: '2026-09-21' }), null);
  assert.equal(clampRun({ kind: RUN_KIND, key: 'nope' }), null);
  const inconsistent = clampRun({ kind: RUN_KIND, key: '2026-09-21', phase: 'write', plan: null, sections: ['x'], failures: '3', trail: 'garbage' });
  assert.equal(inconsistent.phase, 'plan', 'a write phase with no plan is a plan phase');
  assert.deepEqual(inconsistent.sections, []);
  assert.equal(inconsistent.failures, 3);
  assert.deepEqual(inconsistent.trail, []);

  const run = applyStep(newRun('2026-09-21', '', meta.now), nextStep(newRun('2026-09-21', '', meta.now), runSettings), GOOD_PLAN, meta, runSettings);
  const back = clampRun(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(back, run);
  const summary = summariseRun(run, meta.now);
  assert.equal(summary.phase, 'write');
  assert.equal(summary.done, 0);
  assert.equal(summary.total, 4);
  assert.match(summary.label, /^Section 1 of 4/);
  assert.equal(summary.title, run.plan.title);
  assert.equal('plan' in summary, false);
  assert.equal('sections' in summary, false);
  assert.ok(!JSON.stringify(summary).includes('lru_cache'), 'a fact leaked into the summary');
});

check('the lock refuses another caller while fresh and yields when stale', () => {
  const run = newRun('2026-09-21', '', meta.now);
  const held = holdLock(run, 'cron', meta.now);
  assert.equal(held.lock.by, 'cron');
  assert.equal(holdLock(held, 'owner', new Date(meta.now.getTime() + LOCK_MS - 1)), null);
  assert.ok(holdLock(held, 'cron', new Date(meta.now.getTime() + 10)), 'the same caller may continue');
  assert.ok(holdLock(held, 'owner', new Date(meta.now.getTime() + LOCK_MS + 1)), 'a stale lock was honoured');
  assert.equal(summariseRun(held, meta.now).lockedBy, 'cron');
  assert.equal(summariseRun(held, new Date(meta.now.getTime() + LOCK_MS + 1)).lockedBy, undefined);
  const free = releaseLock(held);
  assert.equal('lock' in free, false);
});
```

- [ ] **Step 2: Run to see it fail** — the `load('src/lib/agent-runs.ts')` throws `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create `src/lib/agent-runs.ts`**

```ts
/**
 * The daily post as a run: persisted state, advanced one step at a time.
 *
 * `/api/ai/daily` used to ask a model for the whole post in one request, and
 * on the free pool this site runs on that request did not finish: a slow
 * reasoning model deliberated for eight minutes and answered with nothing,
 * and the next tick started from zero. Decision 60 already writes the long
 * case study as a plan and then one request per section, because a short
 * request finishes and a failed one can be retried alone. This is the same
 * shape for the journal, with one addition the case study did not need: the
 * state lives in a `documents` row rather than in a page, so a cron tick that
 * runs out of time hands the run to the next tick, and the owner's *Run now*
 * can stop and resume it from the panel. Decision 65.
 *
 * Everything here is pure. It imports the parsers and prompt-context builders
 * in `assist-tasks.ts` and the schedule's voice rules in `journal-auto.ts`,
 * holds no secret and does no I/O, so `scripts/test-ai.mjs` drives a whole run
 * through it and the browser reads its summaries. The server half — which
 * loads the row, calls the model and saves — is `agent-runner.ts`.
 *
 * Three rules hold it together:
 *
 *   - **A finished step is never redone.** The plan and every finished section
 *     are on the row; `nextStep()` asks only for what is missing.
 *   - **A failed step is a counted failure, not an exception.** `applyStep()`
 *     and `failStep()` return a run with `failures + 1` and the reason; the
 *     phase does not move, so the next tick tries the same step again. The
 *     owner's `maxAttempts` bounds the day's failures, which is what it always
 *     bounded — cost.
 *   - **The model may decline the day.** A plan step that answers `NOTHING:`
 *     ends the run as `declined`, and the schedule records it rather than
 *     asking the same question of the same index an hour later.
 */

import {
  cleanSection,
  parseFields,
  parsePlan,
  sectionContext,
  sectionWords,
  type AssistTaskName,
  type FieldShape,
  type PlannedSection,
} from './assist-tasks';
import { autoInstruction, type AutoJournalSettings } from './journal-auto';

export const RUN_KIND = 'journal-post' as const;

/** The `documents` slug a day's run lives under. */
export const runSlug = (day: string): string => `run:${RUN_KIND}:${day}`;

/** How long the whole entry aims to be, in words. Spread across 3–6 sections. */
export const POST_WORDS = 950;

/** A lock younger than this is held; older, the holder died and it is taken over. */
export const LOCK_MS = 240_000;

/** Trail rows kept on the row. */
export const TRAIL_CAP = 40;

export type RunPhase = 'plan' | 'write' | 'finish' | 'done' | 'failed' | 'declined';
const PHASES: readonly RunPhase[] = ['plan', 'write', 'finish', 'done', 'failed', 'declined'];

/** The arc that stands in when the model's plan has fewer than three sections. */
export const POST_SECTIONS: readonly PlannedSection[] = [
  { heading: 'What I was trying to do', brief: 'The specific thing, and the constraint that made it worth an entry.' },
  { heading: 'What I tried first, and what broke', brief: 'The wrong turn, named, and what it cost.' },
  { heading: 'What worked', brief: 'The fix, with the actual identifiers and numbers, and the one code block.' },
  { heading: 'What is still open', brief: 'The thing not working yet, the decision not made, what gets tried next.' },
];

/** What `journalplan` returns: four one-line fields, then the facts and sections. */
export const PLAN_KEYS: FieldShape = {
  head: [
    { key: 'title', label: 'TITLE' },
    { key: 'summary', label: 'SUMMARY' },
    { key: 'tags', label: 'TAGS' },
    { key: 'angle', label: 'ANGLE' },
  ],
  tail: { key: 'facts', label: 'FACTS' },
};

export interface PostPlan {
  title: string;
  summary: string;
  tags: string[];
  /** The model's own one-line decision: what this entry is about, and why. */
  angle: string;
  facts: string[];
  sections: PlannedSection[];
}

export interface StepRecord {
  step: string;
  label: string;
  ok: boolean;
  ms: number;
  /** `label · model` that answered, or '' for a step no model ran. */
  model: string;
  note?: string;
  at: string;
}

export interface RunLock {
  by: 'cron' | 'owner';
  at: string;
}

export interface PostRun {
  kind: typeof RUN_KIND;
  /** The UTC day, `YYYY-MM-DD`. */
  key: string;
  phase: RunPhase;
  /** The day's steer, for the screen; the plan step reads it through the settings. */
  topic: string;
  plan: PostPlan | null;
  /** Finished sections, cleaned, in order. */
  sections: string[];
  /** Failed steps so far today. */
  failures: number;
  trail: StepRecord[];
  slug?: string;
  error?: string;
  lock?: RunLock;
  startedAt: string;
  updatedAt: string;
}

/** The step to take now. `task: null` is the assembly, which no model runs. */
export interface RunStep {
  id: string;
  label: string;
  task: AssistTaskName | null;
  context: Record<string, string>;
  instruction: string;
  /** Whether the step is offered the content lookups. */
  lookups: boolean;
}

export interface StepMeta {
  model: string;
  ms: number;
  now?: Date;
}

/** One line of a streamed step, as `/api/ai/runs` sends it. */
export interface StepFrame {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  ms?: number;
  note?: string;
}

/** What every route answers and the screen renders. Never the plan's facts or the sections. */
export interface RunSummary {
  kind: typeof RUN_KIND;
  key: string;
  phase: RunPhase;
  label: string;
  done: number;
  total: number | null;
  failures: number;
  error?: string;
  slug?: string;
  title?: string;
  angle?: string;
  updatedAt: string;
  lockedBy?: 'cron' | 'owner';
  trail: StepRecord[];
}

export function newRun(day: string, topic: string, now = new Date()): PostRun {
  const at = now.toISOString();
  return { kind: RUN_KIND, key: day, phase: 'plan', topic, plan: null, sections: [], failures: 0, trail: [], startedAt: at, updatedAt: at };
}

const str = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '');
const strings = (value: unknown, count: number, each: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).slice(0, count).map(v => v.slice(0, each)) : [];

function clampPlan(raw: unknown): PostPlan | null {
  const s = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!s) return null;
  const title = str(s.title, 200).trim();
  const sections = (Array.isArray(s.sections) ? s.sections : [])
    .map(entry => entry as Record<string, unknown>)
    .filter(entry => entry && typeof entry.heading === 'string' && entry.heading.trim())
    .slice(0, 6)
    .map(entry => ({ heading: str(entry.heading, 120).trim(), brief: str(entry.brief, 400).trim() }));
  if (!title || !sections.length) return null;
  return {
    title,
    summary: str(s.summary, 200).trim(),
    tags: strings(s.tags, 6, 40),
    angle: str(s.angle, 400).trim(),
    facts: strings(s.facts, 40, 400),
    sections,
  };
}

function clampTrail(raw: unknown): StepRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry => entry as Record<string, unknown>)
    .filter(entry => entry && typeof entry.step === 'string')
    .slice(-TRAIL_CAP)
    .map(entry => ({
      step: str(entry.step, 40),
      label: str(entry.label, 200),
      ok: entry.ok === true,
      ms: Number.isFinite(Number(entry.ms)) ? Math.max(0, Math.floor(Number(entry.ms))) : 0,
      model: str(entry.model, 200),
      ...(str(entry.note, 300) ? { note: str(entry.note, 300) } : {}),
      at: str(entry.at, 40),
    }));
}

/**
 * Whatever the row holds, as a run that cannot hurt anyone — or `null` when
 * it is not a run at all. Re-derived key by key like every other JSON column
 * this site reads back, and made consistent: a `write` phase with no plan is
 * a `plan` phase, and more sections than the plan has are cut.
 */
export function clampRun(raw: unknown): PostRun | null {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (s.kind !== RUN_KIND || typeof s.key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.key)) return null;
  const plan = clampPlan(s.plan);
  let phase: RunPhase = PHASES.includes(s.phase as RunPhase) ? (s.phase as RunPhase) : 'plan';
  if (!plan && (phase === 'write' || phase === 'finish')) phase = 'plan';
  const sections = plan ? strings(s.sections, plan.sections.length, 20_000) : [];
  if (phase === 'write' && plan && sections.length >= plan.sections.length) phase = 'finish';
  const failures = Number(s.failures);
  const lockRaw = s.lock as Record<string, unknown> | null | undefined;
  const lock: RunLock | undefined =
    lockRaw && (lockRaw.by === 'cron' || lockRaw.by === 'owner') && typeof lockRaw.at === 'string'
      ? { by: lockRaw.by, at: lockRaw.at }
      : undefined;
  return {
    kind: RUN_KIND,
    key: s.key,
    phase,
    topic: str(s.topic, 200),
    plan,
    sections,
    failures: Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0,
    trail: clampTrail(s.trail),
    ...(str(s.slug, 200) ? { slug: str(s.slug, 200) } : {}),
    ...(str(s.error, 500) ? { error: str(s.error, 500) } : {}),
    ...(lock ? { lock } : {}),
    startedAt: str(s.startedAt, 40),
    updatedAt: str(s.updatedAt, 40),
  };
}

/** The plan in the shape `sectionContext()` and `sectionWords()` read. */
const asPlan = (plan: PostPlan) => ({ facts: plan.facts, sections: plan.sections, planned: true });

export function nextStep(run: PostRun, settings: AutoJournalSettings): RunStep | null {
  if (run.phase === 'plan') {
    return {
      id: 'plan',
      label: 'Planning the entry',
      task: 'journalplan',
      context: {},
      /* The same steer the one-request post got: the day's subject, the
         voice, the anti-invention rule, the owner's standing instruction. */
      instruction: autoInstruction(run.key, settings),
      lookups: true,
    };
  }
  if (run.phase === 'write' && run.plan) {
    const index = run.sections.length;
    const planned = run.plan.sections[index];
    if (!planned) return finishStep(run);
    return {
      id: `section:${index + 1}`,
      label: `Section ${index + 1} of ${run.plan.sections.length}: ${planned.heading}`,
      task: 'journalsection',
      context: {
        title: run.plan.title,
        summary: run.plan.summary,
        ...sectionContext(asPlan(run.plan), index, run.sections[index - 1] ?? '', POST_WORDS),
      },
      instruction: settings.instruction,
      lookups: false,
    };
  }
  if (run.phase === 'finish' && run.plan) return finishStep(run);
  return null;
}

const finishStep = (run: PostRun): RunStep => ({
  id: 'finish',
  label: 'Saving the draft',
  task: null,
  context: {},
  instruction: '',
  lookups: false,
});

const stamp = (meta: StepMeta): string => (meta.now ?? new Date()).toISOString();

const withTrail = (run: PostRun, row: StepRecord, meta: StepMeta): PostRun => ({
  ...run,
  trail: [...run.trail, row].slice(-TRAIL_CAP),
  updatedAt: stamp(meta),
});

const record = (step: RunStep, ok: boolean, meta: StepMeta, note: string): StepRecord => ({
  step: step.id,
  label: step.label,
  ok,
  ms: meta.ms,
  model: meta.model,
  ...(note ? { note: note.slice(0, 300) } : {}),
  at: stamp(meta),
});

/**
 * A step that produced nothing usable. Counted, and the phase kept, so the
 * next tick tries the same step; `maxAttempts` failures end the day.
 */
export function failStep(run: PostRun, step: RunStep, reason: string, meta: StepMeta, settings: AutoJournalSettings): PostRun {
  const failures = run.failures + 1;
  const { slug, ...rest } = run;
  return withTrail(
    { ...rest, ...(slug ? { slug } : {}), phase: failures >= settings.maxAttempts ? 'failed' : run.phase, failures, error: reason.slice(0, 500) },
    record(step, false, meta, reason),
    meta,
  );
}

const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

function applyPlan(run: PostRun, step: RunStep, text: string, meta: StepMeta, settings: AutoJournalSettings): PostRun {
  const declined = text.trim().match(/^(?:\*\*)?NOTHING(?:\*\*)?\s*:\s*([\s\S]*)$/i);
  if (declined) {
    const reason = declined[1].trim().replace(/\s+/g, ' ').slice(0, 300) || 'nothing specific left to write';
    const { error, ...rest } = run;
    return withTrail({ ...rest, phase: 'declined', error: reason }, record(step, true, meta, `Declined: ${reason}`), meta);
  }
  const parsed = parseFields(text, PLAN_KEYS);
  if (!parsed.recognised) return failStep(run, step, 'The plan came back in no recognisable shape.', meta, settings);
  const title = (parsed.values.title ?? '').trim().slice(0, 200);
  if (!title) return failStep(run, step, 'The plan has no title.', meta, settings);
  const shape = parsePlan(`FACTS:\n${parsed.values.facts ?? ''}`, { min: 3, fallback: POST_SECTIONS });
  if (!shape.planned && !shape.facts.length) {
    return failStep(run, step, 'The plan has neither facts nor sections.', meta, settings);
  }
  const plan: PostPlan = {
    title,
    summary: (parsed.values.summary ?? '').trim().slice(0, 200),
    tags: (parsed.values.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 6),
    angle: (parsed.values.angle ?? '').trim().replace(/\s+/g, ' ').slice(0, 400),
    facts: shape.facts,
    sections: shape.sections.slice(0, 6),
  };
  const { error, ...rest } = run;
  return withTrail(
    { ...rest, phase: 'write', plan },
    record(step, true, meta, plan.angle || `${plan.sections.length} sections planned`),
    meta,
  );
}

function applySection(run: PostRun, step: RunStep, text: string, meta: StepMeta, settings: AutoJournalSettings): PostRun {
  if (!run.plan) return failStep(run, step, 'No plan to write from.', meta, settings);
  const index = run.sections.length;
  const planned = run.plan.sections[index];
  if (!planned) return run;
  const cap = Math.round(sectionWords(asPlan(run.plan), POST_WORDS) * 1.8);
  const cleaned = cleanSection(text, planned.heading, cap);
  if (!cleaned) return failStep(run, step, 'The section came back empty, or as the model talking to itself.', meta, settings);
  const sections = [...run.sections, cleaned];
  const { error, ...rest } = run;
  return withTrail(
    { ...rest, phase: sections.length >= run.plan.sections.length ? 'finish' : 'write', sections },
    record(step, true, meta, `${words(cleaned)} words`),
    meta,
  );
}

/**
 * Fold a step's answer into the run. Never throws on a bad answer: that is a
 * counted failure with the reason on the row. The assembly (`task: null`) is
 * the runner's, because it writes a post.
 */
export function applyStep(run: PostRun, step: RunStep, text: string, meta: StepMeta, settings: AutoJournalSettings): PostRun {
  if (step.id === 'plan') return applyPlan(run, step, text, meta, settings);
  if (step.id.startsWith('section:')) return applySection(run, step, text, meta, settings);
  return run;
}

/** The post the finished sections make, or `null` when there is nothing to save. */
export function assemblePost(run: PostRun): { title: string; summary: string; tags: string[]; readTime: string; body: string } | null {
  if (!run.plan || !run.sections.length) return null;
  const body = run.sections.join('\n\n').trim();
  const title = run.plan.title;
  return {
    title,
    /* NOT NULL on the column, and a generated post is not worth failing an
       insert over one missing sentence. */
    summary: run.plan.summary || `${title}.`.slice(0, 200),
    tags: run.plan.tags,
    readTime: `${Math.max(1, Math.round(words(body) / 200))} min`,
    body,
  };
}

export const isTerminal = (run: PostRun): boolean =>
  run.phase === 'done' || run.phase === 'failed' || run.phase === 'declined';

/** Take the lock, or `null` while another caller's lock is fresh. */
export function holdLock(run: PostRun, by: RunLock['by'], now = new Date()): PostRun | null {
  const held = run.lock ? Date.parse(run.lock.at) : NaN;
  if (run.lock && run.lock.by !== by && Number.isFinite(held) && now.getTime() - held < LOCK_MS) return null;
  return { ...run, lock: { by, at: now.toISOString() } };
}

export function releaseLock(run: PostRun): PostRun {
  const { lock, ...rest } = run;
  return rest;
}

export function summariseRun(run: PostRun, now = new Date()): RunSummary {
  const total = run.plan?.sections.length ?? null;
  const done = run.sections.length;
  const next = run.phase === 'write' ? run.plan?.sections[done] : undefined;
  const label =
    run.phase === 'plan' ? 'Planning the entry'
    : run.phase === 'write' ? `Section ${done + 1} of ${total}: ${next?.heading ?? ''}`
    : run.phase === 'finish' ? 'Saving the draft'
    : run.phase === 'done' ? `Drafted "${run.plan?.title ?? ''}".`
    : run.phase === 'declined' ? `Declined: ${run.error ?? ''}`
    : `Failed: ${run.error ?? ''}`;
  const held = run.lock ? Date.parse(run.lock.at) : NaN;
  const lockedBy = run.lock && Number.isFinite(held) && now.getTime() - held < LOCK_MS ? run.lock.by : undefined;
  return {
    kind: RUN_KIND,
    key: run.key,
    phase: run.phase,
    label,
    done,
    total,
    failures: run.failures,
    ...(run.error ? { error: run.error } : {}),
    ...(run.slug ? { slug: run.slug } : {}),
    ...(run.plan ? { title: run.plan.title, angle: run.plan.angle } : {}),
    updatedAt: run.updatedAt,
    ...(lockedBy ? { lockedBy } : {}),
    trail: run.trail.slice(-12),
  };
}
```

Note `failStep` and `applyPlan`/`applySection` drop `error` before re-spreading so a cleared error is absent, not `undefined` — `clampRun` round-trips through JSON and the `deepEqual` in the test needs the two shapes identical.

- [ ] **Step 4: Run the tests** — `ai: 215 checks passed`; fix any `deepEqual` mismatch between a run and its JSON round-trip by making the producing function omit rather than `undefined` the key. `npx astro check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-runs.ts scripts/test-ai.mjs
git commit -m "feat: the daily post as a run of steps — pure state, advanced one step at a time"
```

---

### Task 8: `agent-runner.ts` advances a run on the server, and `/api/ai/daily` loops it

**Files:**
- Create: `src/lib/agent-runner.ts`
- Modify: `src/pages/api/ai/daily.ts` (rewrite the `POST` and `GET`; move `freeSlug`, `insertPost`, `readDoc`, `writeRun`, `ComposeError`, `describe`, `compose` out — the first four to the runner, the rest deleted)
- Modify: `src/lib/ai.ts` — export `agentFrames()` and `linesToStream` (used by Task 9; added here so `ai.ts` is touched once more only)
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Consumes: everything Task 7 exports; `agentComplete`, `callChat`, `getAiSettings`, `modelsFor`, `ProviderError`, `Provider`, `RunSummary as AiRunSummary` from `ai.ts`; `buildIndex`; `MAX_TOOL_CALLS`, `runTool`, `toolSummary`, `toolsFor`; `ASSIST_TASKS`, `assistPrompt`; `getProjects`, `getCaseStudies`, `getPosts`, `pinNewJournalPost`; `getResume`; `renderBody`; `record`; `site`; `AUTO_KEY`, `AUTO_RUN_KEY`, `clampAutoRun`, `clampAutoSettings`, `slugify`, `topicFor`, `dayOf`, `AutoJournalRun`, `AutoJournalSettings`.
- Produces:
  - `STEP_ATTEMPT_MS = 120_000`, `STEP_BUDGET_MS = 240_000`, `TICK_BUDGET_MS = 300_000`
  - `readDoc(db, slug): Promise<unknown>`, `readRunRecord(db)`, `writeRunRecord(db, run: AutoJournalRun)`
  - `loadRun(db, day): Promise<PostRun | null>`, `saveRun(db, run)`, `dropRun(db, day)`
  - `advance(db, run, options: AdvanceOptions): Promise<Advanced>` where `AdvanceOptions = { providers: Provider[]; settings: AutoJournalSettings; caller: 'cron' | 'owner' }` and `Advanced = { run: PostRun; step: RunStep | null; ok: boolean; note: string }`
  - `advanceStreamed(db, run, options): Promise<Response>` (Task 9 fills it; this task exports a stub that throws `new Error('not yet')` so the route compiles — remove in Task 9)
  - from `ai.ts`: `export function agentFrames(options: AgentOptions): AsyncGenerator<unknown>`, `export function linesToStream(lines): ReadableStream<Uint8Array>`

- [ ] **Step 1: Write the failing tests**

Add to the loads: `const { advance, loadRun, saveRun, dropRun, readRunRecord, STEP_ATTEMPT_MS } = await load('src/lib/agent-runner.ts');`

A fake D1 that understands the statements the runner and its content readers issue. Add after the `table()` helper:

```js
/**
 * A D1 stand-in for the runner: `documents` as a map, `journal` and `logs`
 * as arrays, the content tables from `rows`. Dispatch is by statement shape,
 * like `table()` above — enough for the statements this repo writes, and it
 * throws on one it does not know rather than answering nothing.
 */
const store = rows => {
  const documents = new Map();
  const journal = [...(rows.journal ?? [])];
  const logs = [];
  const statement = (sql, values = []) => ({
    bind: (...bound) => statement(sql, bound),
    first: async () => {
      if (/SELECT json FROM documents WHERE slug = \?/.test(sql)) {
        const json = documents.get(values[0]);
        return json === undefined ? null : { json };
      }
      if (/SELECT slug FROM journal WHERE slug = \?/.test(sql)) {
        return journal.find(row => row.slug === values[0]) ? { slug: values[0] } : null;
      }
      if (/FROM documents/.test(sql)) return null;
      throw new Error(`store.first: ${sql}`);
    },
    all: async () => ({
      results: /FROM projects/.test(sql) ? (rows.projects ?? [])
        : /FROM case_studies/.test(sql) ? (rows.caseStudies ?? [])
        : /FROM journal/.test(sql) ? journal
        : /FROM ai_providers/.test(sql) ? []
        : [],
    }),
    run: async () => {
      if (/INSERT INTO documents/.test(sql)) documents.set(values[0], values[1]);
      else if (/DELETE FROM documents WHERE slug LIKE/.test(sql)) {
        for (const slug of [...documents.keys()]) if (slug.startsWith('run:') && slug < values[0]) documents.delete(slug);
      } else if (/DELETE FROM documents WHERE slug = \?/.test(sql)) documents.delete(values[0]);
      else if (/INSERT INTO journal/.test(sql)) journal.push({ slug: values[0], title: values[1], summary: values[2], date: values[3], tags: values[4], read_time: values[5], status: values[6], body_md: values[7], body_html: values[8] });
      else if (/INSERT INTO logs/.test(sql)) logs.push({ level: values[0], source: values[1], message: values[2], detail: values[3] });
      else if (/DELETE FROM logs/.test(sql) || /UPDATE documents|INSERT OR REPLACE INTO documents|journal_order|UPDATE journal/.test(sql)) { /* pin / cap: nothing to do */ }
      else throw new Error(`store.run: ${sql}`);
      return { results: [], success: true, meta: { changes: 1, duration: 0, last_row_id: 0 } };
    },
  });
  return { prepare: sql => statement(sql), documents, journal, logs };
};
```

Check `pinNewJournalPost` and `renderBody` against the stub: `grep -n "prepare(" src/lib/content.ts | sed -n 1,40p` for the statements `pinNewJournalPost` issues and add a branch per shape that throws today. `renderBody` runs Astro's markdown processor — it works under Node (`check:markdown` uses it).

Then the checks:

```js
/* ---------- 16. the runner ---------- */

const runDb = () => store({
  projects: [projectRow('visible-thing', 'Visible Thing', false)],
  caseStudies: [],
  journal: [journalRow('live', 'A Published Post', 'published')],
});
const runOpts = db => ({ providers: [row({})], settings: clampAutoSettings({ enabled: true, maxAttempts: 2 }), caller: 'cron' });

await checkAsync('a run row round-trips through the store and old rows are swept', async () => {
  const db = runDb();
  assert.equal(await loadRun(db, '2026-09-21'), null);
  const run = newRun('2026-09-21', 'x', new Date('2026-09-21T10:00:00Z'));
  await saveRun(db, run);
  assert.deepEqual(await loadRun(db, '2026-09-21'), run);
  await saveRun(db, newRun('2026-09-10', '', new Date('2026-09-21T10:00:00Z')));
  await saveRun(db, run);
  assert.equal(await loadRun(db, '2026-09-10'), null, 'a run from eleven days ago survived the sweep');
  await dropRun(db, '2026-09-21');
  assert.equal(await loadRun(db, '2026-09-21'), null);
});

await checkAsync('advance runs the plan step with a lookup, saves, records and releases the lock', async () => {
  const db = runDb();
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return new Response(JSON.stringify(sent.length === 1
      ? completion(asksFor('c1', 'read_post', '{"slug":"live"}'))
      : completion({ role: 'assistant', content: GOOD_PLAN })), { status: 200 });
  };
  try {
    const out = await advance(db, newRun('2026-09-21', '', new Date()), runOpts(db));
    assert.equal(out.ok, true);
    assert.equal(out.step.id, 'plan');
    assert.equal(out.run.phase, 'write');
    assert.equal('lock' in out.run, false, 'the lock was not released');
    assert.equal(sent[0].stream, false);
    assert.ok(sent[0].tools?.length, 'the plan step was not offered lookups');
    assert.equal(sent[0].reasoning_effort, 'low');
    assert.equal(sent[0].max_tokens, effectiveMaxTokens(row({}), ASSIST_TASKS.journalplan.maxTokens));
    assert.match(sent[0].messages[0].content, /Visible Thing/, 'the index was not sent');
    assert.ok(sent[1].messages.some(m => m.role === 'tool'), 'the lookup result was not carried into the answer round');
    const saved = await loadRun(db, '2026-09-21');
    assert.equal(saved.phase, 'write');
    assert.equal(saved.plan.title, 'The cache I added to the copilot');
    const recordRow = await readRunRecord(db);
    assert.equal(recordRow.day, '2026-09-21');
    assert.equal(recordRow.attempts, 0);
    assert.match(recordRow.note, /^Section 1 of 4/);
    assert.equal(db.logs.length, 1);
    assert.equal(db.logs[0].source, 'daily');
    assert.match(db.logs[0].message, /Planning the entry: answered/);
    const detail = JSON.parse(db.logs[0].detail);
    assert.equal(detail.step, 'plan');
    assert.equal(detail.lookups, 1);
  } finally {
    globalThis.fetch = real;
  }
});

await checkAsync('a provider refusal is a failed step on the row, not a throw, and the record counts it', async () => {
  const db = runDb();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  try {
    const out = await advance(db, newRun('2026-09-21', '', new Date()), runOpts(db));
    assert.equal(out.ok, false);
    assert.equal(out.run.phase, 'plan');
    assert.equal(out.run.failures, 1);
    assert.match(out.run.error, /429/);
    assert.equal((await readRunRecord(db)).attempts, 1);
    assert.equal(db.logs[0].level, 'error');
    const again = await advance(db, out.run, runOpts(db));
    assert.equal(again.run.phase, 'failed', 'maxAttempts (2) did not end the day');
    assert.equal(isTerminal(again.run), true);
  } finally {
    globalThis.fetch = real;
  }
});

await checkAsync('the finish step inserts the draft, pins it, writes the record and the log', async () => {
  const db = runDb();
  let run = newRun('2026-09-21', '', new Date('2026-09-21T10:00:00Z'));
  run = applyStep(run, nextStep(run, runOpts(db).settings), GOOD_PLAN, meta, runOpts(db).settings);
  for (let i = 0; i < 4; i += 1) {
    run = applyStep(run, nextStep(run, runOpts(db).settings), `## ${run.plan.sections[i].heading}\n\nI changed \`lru_cache\` on day ${i + 1}.`, meta, runOpts(db).settings);
  }
  assert.equal(run.phase, 'finish');
  const out = await advance(db, run, runOpts(db));
  assert.equal(out.step.id, 'finish');
  assert.equal(out.run.phase, 'done');
  assert.equal(out.run.slug, 'the-cache-i-added-to-the-copilot');
  const inserted = db.journal.find(r => r.slug === out.run.slug);
  assert.ok(inserted, 'no journal row was inserted');
  assert.equal(inserted.status, 'draft');
  assert.match(inserted.body_md, /^## What the copilot was waiting on/);
  assert.match(inserted.body_html, /<h2/);
  assert.equal(inserted.read_time, '1 min');
  const recordRow = await readRunRecord(db);
  assert.equal(recordRow.slug, out.run.slug);
  assert.match(recordRow.note, /^Drafted "The cache/);
  assert.match(db.logs[db.logs.length - 1].message, /^Drafted "The cache/);
  /* Same title again tomorrow: the slug is suffixed, not refused. */
  const twice = await advance(db, { ...run, key: '2026-09-22' }, runOpts(db));
  assert.equal(twice.run.slug, 'the-cache-i-added-to-the-copilot-2');
  /* Published when the owner said so. */
  const published = await advance(db, { ...run, key: '2026-09-23' }, { ...runOpts(db), settings: clampAutoSettings({ enabled: true, publish: true }) });
  assert.equal(db.journal.find(r => r.slug === published.run.slug).status, 'published');
});
```

- [ ] **Step 2: Run to see it fail** — `ERR_MODULE_NOT_FOUND` for `agent-runner.ts`.

- [ ] **Step 3: Export the frame generator from `ai.ts`**

In `src/lib/ai.ts`, split `agentStream`:

```ts
/**
 * The frames of one streamed run, as objects — what `agentStream()` encodes.
 *
 * Exported for `agent-runner.ts`, which wraps a step's frames in its own
 * before and after them rather than re-parsing the NDJSON it would otherwise
 * be handed.
 */
export function agentFrames(options: AgentOptions): AsyncGenerator<unknown> {
  const summary: RunSummary = { /* …as today… */ };
  const lines =
    !options.call.tools?.length &&
    options.first.response.body &&
    !retryFor(options.first.provider, options.which, options.call)
      ? sseLines(options.first.response.body, thinkingBudget(options.first.provider, options.call.maxTokens))
      : agentLines({ ...options, summary });
  return options.onEnd ? tallied(lines, summary, options.onEnd) : lines;
}

export function agentStream(options: AgentOptions): ReadableStream<Uint8Array> {
  return linesToStream(agentFrames(options));
}
```

and make `linesToStream` `export function linesToStream(…)`.

- [ ] **Step 4: Create `src/lib/agent-runner.ts`**

```ts
/**
 * The server half of a run: load the row, take one step, save the row.
 *
 * `agent-runs.ts` decides what the next step is and what its answer means;
 * this is where the step is actually *run* — the prompt built, the model
 * called through the same tool loop every other surface uses, the answer
 * folded in, the row written, a log line recorded. Two callers, two shapes:
 * the cron tick calls `advance()` in a loop, non-streamed, because the
 * Workers Free plan gives an invocation ten milliseconds of CPU and a stream
 * is per-token work (decision 61); the owner's panel calls `advanceStreamed()`
 * once per step and watches the frames. Both save after every step, which is
 * what "continue where it left off" means here. Decision 65.
 *
 * Nothing in a request reaches a statement: the day is the clock's, the slug
 * is the model's title through `slugify`, and every column name below is a
 * literal — the same rule `/api/ai/daily` kept when the insert lived there.
 */

import {
  ProviderError,
  agentComplete,
  agentFrames,
  callChat,
  getAiSettings,
  linesToStream,
  modelsFor,
  type Completion,
  type Provider,
  type RunSummary as AiRunSummary,
} from './ai';
import { buildIndex } from './ai-corpus';
import { MAX_TOOL_CALLS, runTool, toolSummary, toolsFor } from './ai-tools';
import { ASSIST_TASKS, assistPrompt } from './assist-tasks';
import { getCaseStudies, getPosts, getProjects, pinNewJournalPost } from './content';
import { getResume } from './resume';
import { renderBody } from './markdown';
import { record } from './log';
import { site } from './site';
import {
  AUTO_RUN_KEY,
  clampAutoRun,
  slugify,
  type AutoJournalRun,
  type AutoJournalSettings,
} from './journal-auto';
import {
  applyStep,
  assemblePost,
  clampRun,
  failStep,
  holdLock,
  isTerminal,
  nextStep,
  releaseLock,
  runSlug,
  summariseRun,
  type PostRun,
  type RunStep,
  type StepFrame,
} from './agent-runs';

/** One attempt at the vendor, headers to last byte. */
export const STEP_ATTEMPT_MS = 120_000;
/** When an attempt or a lookup may still *start* within one step. */
export const STEP_BUDGET_MS = 240_000;
/** When a cron tick stops starting new steps. A last step may run four minutes more; the workflow's `curl` waits ten. */
export const TICK_BUDGET_MS = 300_000;

export interface AdvanceOptions {
  providers: Provider[];
  settings: AutoJournalSettings;
  caller: 'cron' | 'owner';
}

export interface Advanced {
  run: PostRun;
  step: RunStep | null;
  ok: boolean;
  note: string;
}

/* ---------- rows ---------- */

/** A `documents` singleton, or `{}`. */
export async function readDoc(db: D1Database, slug: string): Promise<unknown> {
  const row = await db.prepare('SELECT json FROM documents WHERE slug = ?').bind(slug).first<{ json: string }>();
  if (!row) return {};
  try {
    return JSON.parse(row.json);
  } catch {
    return {};
  }
}

async function writeDoc(db: D1Database, slug: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
    .bind(slug, JSON.stringify(value))
    .run();
}

export const readRunRecord = async (db: D1Database): Promise<AutoJournalRun> =>
  clampAutoRun(await readDoc(db, AUTO_RUN_KEY));

/** Best effort: a failed write must not mask why the step failed. */
export const writeRunRecord = (db: D1Database, run: AutoJournalRun): Promise<void> =>
  writeDoc(db, AUTO_RUN_KEY, run).catch(() => {});

export async function loadRun(db: D1Database, day: string): Promise<PostRun | null> {
  return clampRun(await readDoc(db, runSlug(day)));
}

/** Days a finished or abandoned run's row is kept before the sweep below. */
const KEEP_DAYS = 3;

export async function saveRun(db: D1Database, run: PostRun): Promise<void> {
  await writeDoc(db, runSlug(run.key), run);
  /* Rows are one per day and nothing reads an old one, so each save sweeps
     what is older than a few days — lexical on the slug, which ends in an
     ISO date. Best effort. */
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  await db
    .prepare('DELETE FROM documents WHERE slug LIKE ? AND slug < ?')
    .bind(`${runSlug('')}%`, runSlug(cutoff))
    .run()
    .catch(() => {});
}

export async function dropRun(db: D1Database, day: string): Promise<void> {
  await db.prepare('DELETE FROM documents WHERE slug = ?').bind(runSlug(day)).run();
}

/** The run record the screen's status card reads, from the run. */
const recordOf = (run: PostRun): AutoJournalRun => ({
  day: run.key,
  attempts: run.failures,
  slug: run.slug ?? '',
  note: summariseRun(run).label.slice(0, 500),
  at: run.updatedAt,
  declined: run.phase === 'declined',
});

/* ---------- the post ---------- */

async function freeSlug(db: D1Database, base: string): Promise<string> {
  const taken = async (slug: string) =>
    Boolean(await db.prepare('SELECT slug FROM journal WHERE slug = ?').bind(slug).first());
  if (!(await taken(base))) return base;
  for (let n = 2; n < 30; n += 1) {
    const candidate = `${base.slice(0, 76)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`Thirty posts already share the slug "${base}".`);
}

interface AutoPost {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  readTime: string;
  body: string;
  day: string;
}

/**
 * Insert the post, as a draft or — when the owner's settings say so —
 * published. Every column name is a literal here and every value a bound
 * parameter; nothing from any request reaches it. Same statement the route
 * carried before the run existed.
 */
async function insertPost(db: D1Database, post: AutoPost, status: 'draft' | 'published'): Promise<void> {
  await db
    .prepare(
      `INSERT INTO journal
         (slug, title, summary, date, tags, read_time, status, body_md, body_html, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      post.slug,
      post.title,
      post.summary,
      post.day,
      JSON.stringify(post.tags),
      post.readTime || null,
      status,
      post.body,
      await renderBody(post.body),
    )
    .run();
  await pinNewJournalPost(db, post.slug);
}

/* ---------- one step ---------- */

/** What the log is told about a model step. */
const describe = (done: Completion | AiRunSummary | undefined) => {
  if (!done) return {};
  if ('rounds' in done) {
    return {
      model: done.model,
      stopReason: done.stopReason,
      lookups: done.calls,
      rounds: done.rounds,
      thinkingChars: done.reasoning.length,
      answerChars: done.text.length,
      ...(done.usage ? { usage: done.usage } : {}),
    };
  }
  return {
    model: done.model,
    stopReason: done.stopReason,
    lookups: done.lookups,
    thinkingChars: done.thinkingChars,
    answerChars: done.answerChars,
    ...(done.usage ? { usage: done.usage } : {}),
  };
};

async function logStep(
  db: D1Database,
  run: PostRun,
  step: RunStep,
  caller: 'cron' | 'owner',
  ms: number,
  detail: Record<string, unknown>,
): Promise<void> {
  const last = run.trail[run.trail.length - 1];
  const ok = Boolean(last?.ok);
  const outcome = ok ? (run.phase === 'declined' ? 'declined the day' : 'answered') : (last?.note ?? 'failed');
  await record(
    db,
    ok ? 'info' : 'error',
    'daily',
    `Daily post · ${step.label}: ${outcome}${last?.model ? ` · ${last.model}` : ''} · ${(ms / 1000).toFixed(1)} s`,
    { day: run.key, step: step.id, caller, ms, failures: run.failures, ...detail },
  );
}

/** The messages and the call for a model step. */
async function prepare(db: D1Database, step: RunStep, options: AdvanceOptions) {
  const task = ASSIST_TASKS[step.task as Exclude<RunStep['task'], null>];
  const aiSettings = await getAiSettings(db);
  const tools = step.lookups && options.providers[0]?.toolsEnabled ? toolsFor('assist') : [];
  let corpus = '';
  if (task.needsCorpus || tools.length) {
    const [projects, caseStudies, posts, resume] = await Promise.all([
      getProjects(db),
      getCaseStudies(db),
      getPosts(db),
      getResume(db),
    ]);
    corpus = buildIndex({ projects, caseStudies, posts, resume });
  }
  const messages = assistPrompt(task, {
    ownerName: site.name,
    context: step.context,
    instruction: step.instruction,
    corpus,
    persona: aiSettings.persona,
    history: [],
    tools: tools.length ? toolSummary('assist') : '',
  });
  /* The model the owner configured, when it is one of their own rows — the
     same lookup `/api/ai/assist` does: a model id in a settings row is still
     a value deciding what the key pays for. */
  const wanted = options.settings.model.trim();
  const model = options.providers.some(p => modelsFor(p, 'assist').includes(wanted)) ? wanted : '';
  const call = {
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    timeoutMs: STEP_ATTEMPT_MS,
    deadline: Date.now() + STEP_BUDGET_MS,
    /* Low, and not negotiable here: nobody is watching, and every token of
       deliberation comes out of the same ceiling the section has to fit in. */
    effort: 'low' as const,
    ...(tools.length ? { tools } : {}),
    ...(model ? { model } : {}),
  };
  return { messages, call };
}

/** The run after a model step's answer, good or bad. */
function settle(
  run: PostRun,
  step: RunStep,
  answer: { text: string; thinking: number; stopReason: string; model: string; error?: string },
  ms: number,
  settings: AutoJournalSettings,
): PostRun {
  const meta = { model: answer.model, ms };
  if (answer.error) return failStep(run, step, answer.error, meta, settings);
  if (!answer.text.trim()) {
    return failStep(
      run,
      step,
      answer.thinking
        ? 'The model spent the whole step thinking and wrote nothing, and a retry with reasoning off did the same.'
        : 'The model wrote nothing.',
      meta,
      settings,
    );
  }
  /* A section cut off by the ceiling is half a section, and this job may
     publish. The next attempt is the retry. */
  if (answer.stopReason === 'length') return failStep(run, step, 'The model hit the token ceiling before finishing.', meta, settings);
  return applyStep(run, step, answer.text, meta, settings);
}

async function finish(db: D1Database, run: PostRun, step: RunStep, options: AdvanceOptions, started: number): Promise<PostRun> {
  const meta = { model: '', ms: 0 };
  const post = assemblePost(run);
  if (!post) return failStep(run, step, 'Nothing to save.', meta, options.settings);
  const base = slugify(post.title);
  if (!base) return failStep(run, step, `The title produced no usable slug: "${post.title}".`, meta, options.settings);
  try {
    const slug = await freeSlug(db, base);
    const status = options.settings.publish ? 'published' : 'draft';
    await insertPost(db, { ...post, slug, day: run.key }, status);
    const ms = Date.now() - started;
    await record(db, 'info', 'daily', `${status === 'published' ? 'Published' : 'Drafted'} "${post.title}".`, {
      slug,
      day: run.key,
      caller: options.caller,
      ms,
      sections: run.sections.length,
      words: post.body.split(/\s+/).filter(Boolean).length,
      failures: run.failures,
    });
    const { error, ...rest } = run;
    return {
      ...rest,
      phase: 'done',
      slug,
      trail: [...run.trail, { step: step.id, label: step.label, ok: true, ms, model: '', note: `${status} · /admin/journal/${slug}`, at: new Date().toISOString() }].slice(-40),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return failStep(run, step, error instanceof Error ? error.message : 'The insert failed.', { model: '', ms: Date.now() - started }, options.settings);
  }
}

/**
 * One step, non-streamed. Never throws for a step that failed: the failure
 * is on the row, counted, and the caller decides whether to go on. The lock
 * is taken before the step and released with the save after it; a caller
 * that could not take it gets `ok: false, note: 'busy'` and nothing changes.
 */
export async function advance(db: D1Database, run: PostRun, options: AdvanceOptions): Promise<Advanced> {
  const step = nextStep(run, options.settings);
  if (!step) return { run, step: null, ok: true, note: 'Nothing to do.' };
  const held = holdLock(run, options.caller);
  if (!held) return { run, step, ok: false, note: 'busy' };
  await saveRun(db, held);
  const started = Date.now();

  let next: PostRun;
  if (!step.task) {
    next = await finish(db, held, step, options, started);
  } else {
    let detail: Record<string, unknown> = {};
    try {
      const { messages, call } = await prepare(db, step, options);
      const done = await agentComplete({
        providers: options.providers,
        which: 'assist',
        call,
        messages,
        runTool: (name, args) => runTool(db, name, args),
        maxCalls: MAX_TOOL_CALLS,
      });
      detail = { ...describe(done), head: done.text.slice(0, 600) };
      next = settle(held, step, { text: done.text, thinking: done.reasoning.length, stopReason: done.stopReason, model: done.model }, Date.now() - started, options.settings);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The step failed.';
      detail = error instanceof ProviderError ? { status: error.status } : {};
      next = failStep(held, step, reason, { model: '', ms: Date.now() - started }, options.settings);
    }
    await logStep(db, next, step, options.caller, Date.now() - started, detail);
  }

  next = releaseLock(next);
  await saveRun(db, next);
  await writeRunRecord(db, recordOf(next));
  const last = next.trail[next.trail.length - 1];
  return { run: next, step, ok: Boolean(last?.ok), note: last?.note ?? '' };
}

/** Task 9 fills this in. */
export async function advanceStreamed(_db: D1Database, _run: PostRun, _options: AdvanceOptions): Promise<Response> {
  throw new Error('not yet');
}

export { isTerminal, type StepFrame };
```

If `describe`'s union narrowing complains under `astro check`, split it into `describeCompletion(done: Completion)` and `describeSummary(summary: AiRunSummary)` with the same fields.

- [ ] **Step 5: Rewrite `src/pages/api/ai/daily.ts`**

Keep the header comment (update the "It writes a draft" paragraph to say the post is now a run of steps — see decision 65 — and that a tick answers `in-progress` when its budget runs out), `secretMatches`, `authorise`, and `prerender`. Delete `freeSlug`, `AutoPost`, `insertPost`, `readDoc`, `writeRun`, `DAILY_BUDGET_MS`, `DAILY_ATTEMPT_MS`, `ComposeError`, `describe`, `Composed`, `compose`. New imports:

```ts
import type { APIRoute } from 'astro';
import { Unauthorized, json, refusal, requireOwner } from '../../../lib/authorize';
import { usableProviders } from '../../../lib/ai';
import { AUTO_KEY, clampAutoSettings, decide, topicFor } from '../../../lib/journal-auto';
import { isTerminal, newRun, summariseRun } from '../../../lib/agent-runs';
import { TICK_BUDGET_MS, advance, loadRun, readDoc, readRunRecord } from '../../../lib/agent-runner';
import { site } from '../../../lib/site';
```

The route:

```ts
export const POST: APIRoute = async ({ request, locals }) => {
  const { DB, CRON_SECRET } = locals.runtime.env;

  let caller: 'cron' | 'owner';
  try {
    caller = await authorise(request, CRON_SECRET);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  /* Only the owner may jump the schedule. A leaked cron secret that could
     also force a run would be a leaked secret that can spend the whole day's
     budget in a loop; one that can only ask "is it time yet" is worth less. */
  const force = caller === 'owner' && body.force === true;

  const settings = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const record = await readRunRecord(DB);
  const now = new Date();
  const started = now.getTime();
  const verdict = decide(now, settings, record);

  if (!verdict.act && !force) {
    return json({ ok: true, status: 'skipped', reason: verdict.reason, day: verdict.day });
  }

  const providers = await usableProviders(DB);
  if (!providers.length) {
    return json({ ok: false, status: 'failed', reason: 'No AI provider is active and holding a key.' }, 503);
  }

  /* Today's run, or a new one. The steps are the retry: a tick that runs out
     of time leaves the row where it got to, and the next tick continues it.
     Nothing here re-reads the settings between steps. Decision 65. */
  let run = (await loadRun(DB, verdict.day)) ?? newRun(verdict.day, topicFor(verdict.day, settings), now);
  if (isTerminal(run) && !force) {
    return json({ ok: true, status: run.phase === 'done' ? 'written' : run.phase, day: verdict.day, run: summariseRun(run) });
  }
  if (isTerminal(run) && force) run = newRun(verdict.day, topicFor(verdict.day, settings), now);

  let last = await advance(DB, run, { providers, settings, caller });
  if (last.note === 'busy') {
    return json({ ok: true, status: 'busy', day: verdict.day, run: summariseRun(last.run) });
  }
  while (!isTerminal(last.run) && Date.now() - started < TICK_BUDGET_MS) {
    last = await advance(DB, last.run, { providers, settings, caller });
    if (last.note === 'busy') break;
  }

  const summary = summariseRun(last.run);
  if (last.run.phase === 'done' && last.run.slug) {
    const status = settings.publish ? 'published' : 'draft';
    return json({
      ok: true,
      status: 'written',
      postStatus: status,
      slug: last.run.slug,
      title: last.run.plan?.title ?? '',
      day: verdict.day,
      edit: `${site.url}/admin/journal/${last.run.slug}`,
      ...(status === 'published' ? { live: `${site.url}/journal/${last.run.slug}` } : {}),
      run: summary,
    });
  }
  if (last.run.phase === 'declined') return json({ ok: true, status: 'declined', reason: last.run.error, day: verdict.day, run: summary });
  if (last.run.phase === 'failed') {
    /* A 502 rather than a 200, so the workflow's step goes red and the
       failure is visible where the owner already looks. */
    return json({ ok: false, status: 'failed', reason: last.run.error, day: verdict.day, run: summary }, 502);
  }
  return json({ ok: true, status: 'in-progress', day: verdict.day, run: summary });
};

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB, CRON_SECRET } = locals.runtime.env;
  const settings = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const run = await readRunRecord(DB);
  const now = new Date();
  const verdict = decide(now, settings, run);
  const work = await loadRun(DB, verdict.day);
  return json({
    settings,
    run,
    scheduled: Boolean(CRON_SECRET && CRON_SECRET.trim()),
    next: verdict.act ? 'Due now.' : verdict.reason,
    work: work ? summariseRun(work, now) : null,
  });
};
```

- [ ] **Step 6: Run the tests and the type gate**

`npm run check:ai 2>&1 | grep -E "FAIL|checks passed"` → `ai: 219 checks passed`. `npx astro check 2>&1 | tail -3` → 0 errors. `npm run check:content` → passes (the route still declares `prerender = false`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent-runner.ts src/lib/ai.ts src/pages/api/ai/daily.ts scripts/test-ai.mjs
git commit -m "feat: the daily tick advances a persisted run step by step and answers in-progress when its budget runs out"
```

---

### Task 9: One streamed step for the owner, and `/api/ai/runs`

**Files:**
- Modify: `src/lib/agent-runner.ts` — replace the `advanceStreamed` stub
- Create: `src/pages/api/ai/runs.ts`
- Test: `scripts/test-ai.mjs`

**Interfaces:**
- Produces: `advanceStreamed(db, run, options): Promise<Response>` — NDJSON: `{step:{…status:'running'}}`, the model's frames (`thinking`, `tool`, `delta`, `usage`), `{step:{…status:'done'|'error', ms, note}}`, `{run: RunSummary}`, `{done:true, stopReason?}`. Never an `{error}` line: a model error becomes the step's note. A partial answer is never stored: the step is folded in only after the inner generator has completed, and a client that hangs up mid-step returns the generator at its next yield — before that code runs — so the `finally` releases the lock and logs `stopped`. (If the model finishes the step after the client left, the completed step is stored; that is a finished step, not a partial one.)
- Route: `POST /api/ai/runs {kind:'journal-post', action:'step'|'discard'}`; `GET /api/ai/runs?kind=journal-post` → `{ run: RunSummary | null }`.

- [ ] **Step 1: Write the failing tests**

Add `advanceStreamed` to the runner load. Then:

```js
const readFrames = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

await checkAsync('a streamed step wraps the model’s frames in step and run frames and saves on completion', async () => {
  const db = runDb();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse([{ choices: [{ delta: { reasoning: 'thinking' } }] }, text(GOOD_PLAN), { choices: [{ finish_reason: 'stop' }] }]), { status: 200 });
  try {
    const response = await advanceStreamed(db, newRun('2026-09-21', '', new Date()), { ...runOpts(db), caller: 'owner' });
    assert.equal(response.headers.get('Content-Type'), 'application/x-ndjson; charset=utf-8');
    const frames = await readFrames(response);
    assert.deepEqual(frames[0].step, { id: 'plan', label: 'Planning the entry', status: 'running' });
    assert.ok(frames.some(f => f.thinking === 'thinking'));
    assert.ok(frames.some(f => f.delta), 'the answer did not stream');
    const done = frames.find(f => f.step?.status === 'done');
    assert.ok(done, 'no step-done frame');
    assert.match(done.step.note, /halved p95/);
    const run = frames.find(f => f.run);
    assert.equal(run.run.phase, 'write');
    assert.equal(frames[frames.length - 1].done, true, 'done is not the last frame');
    assert.ok(frames.indexOf(run) < frames.length - 1, 'the run frame came after done');
    const saved = await loadRun(db, '2026-09-21');
    assert.equal(saved.phase, 'write');
    assert.equal('lock' in saved, false);
    assert.equal(db.logs.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

await checkAsync('a model error mid-stream is the step’s outcome, never an error line', async () => {
  const db = runDb();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse([thinks(400), { choices: [{ finish_reason: 'length' }] }]), { status: 200 });
  try {
    const frames = await readFrames(await advanceStreamed(db, newRun('2026-09-21', '', new Date()), { ...runOpts(db), caller: 'owner' }));
    assert.ok(!frames.some(f => typeof f.error === 'string'), 'an error line would end the reader’s stream before the run frame');
    const failed = frames.find(f => f.step?.status === 'error');
    assert.match(failed.step.note, /thinking/);
    assert.equal(frames.find(f => f.run).run.failures, 1);
    assert.equal((await loadRun(db, '2026-09-21')).failures, 1);
  } finally {
    globalThis.fetch = real;
  }
});

await checkAsync('a cancelled step stores nothing and releases the lock', async () => {
  const db = runDb();
  const real = globalThis.fetch;
  let release;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(text('TITLE: half'))}\n\n`));
          release = () => controller.close();
        },
      }),
      { status: 200 },
    );
  try {
    const response = await advanceStreamed(db, newRun('2026-09-21', '', new Date()), { ...runOpts(db), caller: 'owner' });
    const reader = response.body.getReader();
    /* One read (the step frame), then the client hangs up. The upstream is
       closed right after, which is what lets the generators unwind — a
       `return()` on a generator awaiting a read is honoured at its next
       yield, and the vendor's stream ending is what produces one. */
    await reader.read();
    const cancelled = reader.cancel();
    release();
    await cancelled;
    await new Promise(resolve => setTimeout(resolve, 50));
    const saved = await loadRun(db, '2026-09-21');
    assert.equal(saved.phase, 'plan');
    assert.equal(saved.failures, 0);
    assert.equal('lock' in saved, false, 'the lock outlived the cancelled step');
    assert.ok(db.logs.some(row => /stopped/.test(row.message)));
  } finally {
    release?.();
    globalThis.fetch = real;
  }
});

await checkAsync('a fresh lock held by the schedule refuses the owner’s step', async () => {
  const db = runDb();
  const held = holdLock(newRun('2026-09-21', '', new Date()), 'cron');
  await saveRun(db, held);
  const out = await advance(db, held, { ...runOpts(db), caller: 'owner' });
  assert.equal(out.note, 'busy');
  await assert.rejects(advanceStreamed(db, held, { ...runOpts(db), caller: 'owner' }), /writing this post right now/);
});
```

- [ ] **Step 2: Run to see it fail** — `not yet`.

- [ ] **Step 3: Implement `advanceStreamed`**

Replace the stub:

```ts
/**
 * One step, streamed — the owner watching from the panel.
 *
 * The model's frames pass through as they are; around them go a `step`
 * frame before and after, and a `run` summary before the final `done`. A
 * model `error` frame is *not* forwarded: the panel's reader ends the stream
 * on one, and the step's own outcome frame carries the message instead. The
 * step is folded in only once every frame has arrived — a stream the client
 * cancels stores nothing, so a stopped section is never saved half-written;
 * the `finally` releases the lock and leaves a line in the log.
 */
export async function advanceStreamed(db: D1Database, run: PostRun, options: AdvanceOptions): Promise<Response> {
  const step = nextStep(run, options.settings);
  const held = step ? holdLock(run, options.caller) : run;
  if (!held) throw new ProviderError('The schedule is writing this post right now. Try again in a few minutes.', 409);
  if (step) await saveRun(db, held);

  const frames = step ? stepFrames(db, held, step, options) : finished(held);
  return new Response(linesToStream(frames), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function* finished(run: PostRun): AsyncGenerator<unknown> {
  yield { run: summariseRun(run) };
  yield { done: true };
}

const frame = (step: RunStep, fields: Partial<StepFrame>): { step: StepFrame } => ({
  step: { id: step.id, label: step.label, status: 'running', ...fields },
});

async function* stepFrames(db: D1Database, held: PostRun, step: RunStep, options: AdvanceOptions): AsyncGenerator<unknown> {
  const started = Date.now();
  yield frame(step, {});
  let settled = false;
  try {
    let next: PostRun;
    let detail: Record<string, unknown> = {};
    let done: Record<string, unknown> = { done: true };

    if (!step.task) {
      next = await finish(db, held, step, options, started);
    } else {
      let summary: AiRunSummary | undefined;
      let failure = '';
      try {
        const { messages, call } = await prepare(db, step, options);
        const first = await callChat(options.providers, { ...call, messages, stream: true }, 'assist');
        if (!first.response.body) throw new ProviderError('The model returned nothing.');
        for await (const raw of agentFrames({
          first,
          which: 'assist',
          call: { ...call, stream: true },
          messages,
          runTool: (name, args) => runTool(db, name, args),
          maxCalls: MAX_TOOL_CALLS,
          onEnd: s => {
            summary = s;
          },
        })) {
          const f = raw as { done?: boolean; error?: string };
          if (f.done) {
            done = raw as Record<string, unknown>;
            continue;
          }
          if (typeof f.error === 'string') {
            failure = f.error;
            continue;
          }
          yield raw;
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : 'The step failed.';
        if (error instanceof ProviderError) detail = { status: error.status };
      }
      const ms = Date.now() - started;
      if (summary) detail = { ...detail, ...describe(summary), head: summary.answer.slice(0, 600) };
      next = settle(
        held,
        step,
        {
          text: summary?.answer ?? '',
          thinking: summary?.thinkingChars ?? 0,
          stopReason: summary?.stopReason ?? '',
          model: summary?.model ?? '',
          ...(failure ? { error: failure } : {}),
        },
        ms,
        options.settings,
      );
      await logStep(db, next, step, options.caller, ms, detail);
    }

    settled = true;
    next = releaseLock(next);
    await saveRun(db, next);
    await writeRunRecord(db, recordOf(next));
    const last = next.trail[next.trail.length - 1];
    yield frame(step, { status: last?.ok ? 'done' : 'error', ms: Date.now() - started, ...(last?.note ? { note: last.note } : {}) });
    yield { run: summariseRun(next) };
    yield done;
  } finally {
    if (!settled) {
      await saveRun(db, releaseLock(held));
      await record(db, 'warn', 'daily', `Daily post · ${step.label}: stopped before it finished`, {
        day: held.key,
        step: step.id,
        caller: options.caller,
        ms: Date.now() - started,
      });
    }
  }
}
```

Note the `error` variable named by `catch (error)` inside `settle` — rename the local in `stepFrames`'s catch to `thrown` if the linter or `astro check` flags shadowing; nothing here is shadowed today.

- [ ] **Step 4: Create `src/pages/api/ai/runs.ts`**

```ts
import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import { ProviderError, usableProviders } from '../../../lib/ai';
import { RUN_KIND, newRun, summariseRun } from '../../../lib/agent-runs';
import { advanceStreamed, dropRun, loadRun, readDoc } from '../../../lib/agent-runner';
import { AUTO_KEY, clampAutoSettings, dayOf, topicFor } from '../../../lib/journal-auto';

/**
 * The owner driving a run, one step per request.
 *
 * The clock's half of the same run is `/api/ai/daily`: a tick loops steps
 * non-streamed until its budget runs out. This is the panel's half — one
 * streamed step, so the owner watches the plan being decided and each section
 * arriving, and Stop keeps what finished. Both advance the same row through
 * `agent-runner.ts`, and a lock stops them advancing it at once. Decision 65.
 *
 * Closed like every other AI route: `kind` is matched against a literal,
 * `action` is one of two words, and nothing in the body is a prompt, a model,
 * a slug or a table. Today's run is the only run the owner can drive — the
 * day comes from the clock, never from the request.
 */

export const prerender = false;

const actions = ['step', 'discard'] as const;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; action?: unknown };
  if (body.kind !== RUN_KIND) return json({ error: `Unknown run kind. Expected ${RUN_KIND}.` }, 400);
  const action = actions.find(name => name === body.action);
  if (!action) return json({ error: `Unknown action. Expected one of: ${actions.join(', ')}.` }, 400);

  const { DB } = locals.runtime.env;
  const day = dayOf(new Date());

  if (action === 'discard') {
    await dropRun(DB, day);
    return json({ ok: true });
  }

  const providers = await usableProviders(DB);
  if (!providers.length) {
    return json({ error: 'No AI provider is active and holding a key. Configure one on the AI screen.' }, 503);
  }
  const settings = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const run = (await loadRun(DB, day)) ?? newRun(day, topicFor(day, settings), new Date());
  try {
    return await advanceStreamed(DB, run, { providers, settings, caller: 'owner' });
  } catch (error) {
    if (error instanceof ProviderError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : 'The step failed.' }, 500);
  }
};

export const GET: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  if (url.searchParams.get('kind') !== RUN_KIND) return json({ error: `Unknown run kind. Expected ${RUN_KIND}.` }, 400);
  const run = await loadRun(locals.runtime.env.DB, dayOf(new Date()));
  return json({ run: run ? summariseRun(run) : null });
};
```

- [ ] **Step 5: Run the tests and the gates** — `ai: 223 checks passed`; `npx astro check` 0 errors; `npm run check:content` passes (the new route reads `locals.runtime` and declares `prerender = false`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-runner.ts src/pages/api/ai/runs.ts scripts/test-ai.mjs
git commit -m "feat: the owner drives a run one streamed step at a time through /api/ai/runs"
```

---

### Task 10: The Journal screen shows the run — the panel, Run now, Resume and Discard

**Files:**
- Modify: `src/lib/ai-store.ts` — `StreamHandlers`, `readStream()`, replace `runAutoJournalNow()` with `runStep()`, `discardRun()`, `loadRun()`; `AutoJournalOverview` gains `work`
- Modify: `src/pages/admin/journal.astro` — import and render `<AssistPanel>` after `#admin-journal`
- Modify: `src/components/DailyJournalPanel.astro` — status card markup (Resume / Discard), the script's Run now, the panel mount, the poll
- Test: browser, against `astro dev`

**Interfaces:**
- Consumes: `StepFrame`, `RunSummary` from `agent-runs.ts`; `mountAssistPanel`, `AssistTurn` from `assist-panel.ts`.
- Produces: `runStep(handlers, signal?)`, `discardRun()`, `loadRun()`; `StreamHandlers.onStep?`, `StreamHandlers.onRun?`.

- [ ] **Step 1: `ai-store.ts`**

Add the import `import type { RunSummary, StepFrame } from './agent-runs';` (type-only — `agent-runs.ts` is browser-safe, but the store needs only the types). `AutoJournalOverview` gains `work: RunSummary | null;`. Replace `runAutoJournalNow` with:

```ts
/**
 * Advance today's run one step, streaming what the model does.
 *
 * The owner pressing Run now — or Resume — on the Journal screen. The step
 * goes out with their GitHub token and the endpoint decides which step it
 * is; the panel renders the frames. Stop aborts the request and the endpoint
 * stores nothing for a step that did not finish.
 */
export async function runStep(handlers: StreamHandlers, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/ai/runs', {
    method: 'POST',
    headers: authorized(),
    body: JSON.stringify({ kind: 'journal-post', action: 'step' }),
    signal,
  });
  return readStream(response, handlers);
}

/** Throw today's unfinished run away. The next tick, or the next Run now, starts over. */
export const discardRun = (): Promise<{ ok?: boolean }> =>
  read('/api/ai/runs', { method: 'POST', body: JSON.stringify({ kind: 'journal-post', action: 'discard' }) });

export const loadRun = (): Promise<{ run: RunSummary | null }> => read('/api/ai/runs?kind=journal-post');
```

`StreamHandlers` gains:

```ts
  /** A step of a run beginning, then ending — see `/api/ai/runs`. */
  onStep?: (frame: StepFrame) => void;
  /** The run's summary, once the step has been folded in. */
  onRun?: (run: RunSummary) => void;
```

In `readStream`, extend the `frame` type with `step?: StepFrame; run?: RunSummary;` and dispatch `if (frame.step) handlers.onStep?.(frame.step); if (frame.run) handlers.onRun?.(frame.run);` before the `delta` branch.

- [ ] **Step 2: `journal.astro`**

Add `import AssistPanel from '../../components/AssistPanel.astro';` and, after the closing `</div>` of `#admin-journal` and before `</AdminLayout>`:

```astro
  {/* The same panel the editors mount, here for the daily run: Run now on
      the Daily journal tab opens it and drives the post one step at a time
      through `/api/ai/runs`, so the thinking, the lookups and each section
      land where the owner is looking. A direct child of `.admin-main`, which
      the freeze rule in `modal.ts` counts on. Decision 65. */}
  <AssistPanel
    surface="journal"
    sub="Shows the daily post being written, step by step. Nothing here changes a post."
  />
```

- [ ] **Step 3: `DailyJournalPanel.astro` markup**

Replace the status card's `Run now` block with:

```astro
        <hr class="rule dj-rule" />
        <p class="text-muted admin-note" id="dj-work" hidden></p>
        <div class="dj-run-row">
          <button type="button" class="btn btn-secondary" id="dj-run">Run now</button>
          <button type="button" class="btn btn-ghost" id="dj-discard" hidden>Discard</button>
        </div>
        <p class="text-muted admin-note">
          Writes today's post now, whatever the clock says, and shows each step in the
          assistant panel. Stop keeps what finished; Resume carries on from there. It counts
          as the day's post — the schedule will not write a second one.
        </p>
```

and add `.dj-run-row { display: flex; gap: var(--space-2); align-items: center; }` to the style block.

- [ ] **Step 4: `DailyJournalPanel.astro` script**

Change the imports:

```ts
  import { onAdminPage, setBusy, setLabel, toast, trackDirty, type DirtyField } from '../lib/admin';
  import { discardRun, loadAutoJournal, loadOverview, runAssist, runStep, saveAutoJournal } from '../lib/ai-store';
  import { mountAssistPanel, type AssistTurn } from '../lib/assist-panel';
  import { getToken } from '../lib/github';
  import { clampAutoSettings, dayOf, hourFor, type AutoJournalSettings } from '../lib/journal-auto';
  import type { RunSummary, StepFrame } from '../lib/agent-runs';
```

After `const runBtn = …` add `const discardBtn = $<HTMLButtonElement>('dj-discard'); const work = $('dj-work');`.

Replace the `runBtn.addEventListener('click', …)` block with:

```ts
    /* ---------- the run, in the panel ----------

       Run now used to be one request and a pending toast. It is a run of
       steps now — plan, one request per section, save — and each step is a
       turn in the assistant panel: the thinking, the lookups, the section
       arriving. Stop aborts the step in flight (the endpoint stores nothing
       for it) and everything finished stays on the row, so the button reads
       Resume. Decision 65. */
    let driving: AbortController | null = null;
    let chatting: AbortController | null = null;

    const panel = mountAssistPanel({
      surface: 'journal',
      docSlug: () => 'daily-journal',
      stop: () => {
        driving?.abort();
        chatting?.abort();
      },
      /* Every command belongs to an open post; this screen has none. Plain
         conversation still works — about the site, with lookups. */
      blocked: () => 'Open a post to run this command.',
      run: async (item, instruction) => {
        if (item) return;
        chatting?.abort();
        const controller = new AbortController();
        chatting = controller;
        const turn = panel.begin('Chat', null);
        panel.running(true);
        let text = '';
        try {
          text = await runAssist(
            'chat',
            {},
            instruction,
            {
              onDelta: chunk => {
                text += chunk;
                turn.answer(text);
              },
              onThinking: chunk => turn.thinking(chunk),
              onTool: frame => turn.tool(frame),
            },
            controller.signal,
            panel.history(),
            panel.runOptions(),
          );
          turn.end(text);
        } catch (error) {
          turn.note(error instanceof DOMException && error.name === 'AbortError' ? 'Stopped.' : error instanceof Error ? error.message : 'That did not work.', 'error');
          turn.end(text);
        } finally {
          panel.running(false);
          if (chatting === controller) chatting = null;
        }
      },
    });

    const terminal = (run: RunSummary | null) =>
      Boolean(run && (run.phase === 'done' || run.phase === 'failed' || run.phase === 'declined'));

    async function drive() {
      driving?.abort();
      const controller = new AbortController();
      driving = controller;
      panel.open();
      panel.running(true);
      setBusy(runBtn, true, 'Writing…');
      /* A holder rather than three `let`s: the frames arrive in callbacks,
         and TypeScript narrows a `let` assigned `null` to `null` across the
         await regardless of what a closure did to it. */
      const seen: { run: RunSummary | null } = { run: null };
      try {
        /* Bounded: a plan and at most six sections and a save. */
        for (let steps = 0; steps < 9; steps += 1) {
          const step: { turn: AssistTurn | null; text: string; ended: StepFrame | null } = { turn: null, text: '', ended: null };
          await runStep(
            {
              onStep: frame => {
                if (frame.status === 'running') {
                  step.turn = panel.begin(frame.label, null);
                  step.turn.status('Working…');
                } else {
                  step.ended = frame;
                }
              },
              onThinking: chunk => step.turn?.thinking(chunk),
              onTool: frame => step.turn?.tool(frame),
              onDelta: chunk => {
                step.text += chunk;
                step.turn?.answer(step.text);
              },
              onRun: run => {
                seen.run = run;
              },
            },
            controller.signal,
          );
          if (step.turn) {
            if (step.ended?.status === 'error') step.turn.note(step.ended.note ?? 'The step failed.', 'error');
            else if (step.ended?.note && !step.text.trim()) step.turn.status(step.ended.note);
            step.turn.end(step.text);
          }
          if (!seen.run || terminal(seen.run) || step.ended?.status === 'error') break;
        }
        const run = seen.run;
        if (run?.phase === 'done' && run.slug) {
          panel.say(`${run.label} Open it to read and publish: /admin/journal/${run.slug}`);
          say(`${run.label} It is ${currentPublish() === 'published' ? 'live' : 'a draft'}.`);
        } else if (run?.phase === 'declined') {
          panel.say(run.label);
          say(run.label);
        } else if (run?.phase === 'failed') {
          panel.say(run.label, 'error');
          say(run.label, 'error');
        } else if (run) {
          panel.say('That step failed. Press Resume to try it again; what finished is kept.', 'error');
        }
      } catch (error) {
        const stopped = error instanceof DOMException && error.name === 'AbortError';
        const text = stopped ? 'Stopped. What finished is kept — Resume carries on.' : error instanceof Error ? error.message : 'The daily post failed.';
        panel.say(text, stopped ? 'info' : 'error');
        say(text, stopped ? 'info' : 'error');
      } finally {
        panel.running(false);
        setBusy(runBtn, false);
        if (driving === controller) driving = null;
        await refresh();
      }
    }

    runBtn.addEventListener('click', () => void drive());

    /* Two-click, like every delete on the surface. */
    let armed = false;
    discardBtn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        setLabel(discardBtn, 'Discard today’s progress?');
        setTimeout(() => {
          armed = false;
          setLabel(discardBtn, null);
        }, 4000);
        return;
      }
      armed = false;
      setLabel(discardBtn, null);
      setBusy(discardBtn, true, 'Discarding…');
      try {
        await discardRun();
        toast('Today’s run was discarded.', { tone: 'success' });
      } catch (error) {
        fail(error);
      }
      setBusy(discardBtn, false);
      await refresh();
    });
```

In `refresh()`, after the `last.textContent = …` line, render the work summary and arm the poll:

```ts
        const run = data.work;
        const live = run && !terminal(run);
        work.hidden = !run;
        if (run) {
          const when = run.updatedAt ? ` · ${localStamp(run.updatedAt)}` : '';
          work.textContent = run.lockedBy === 'cron'
            ? `The schedule is writing this post now — ${run.label}${when}`
            : live
              ? `In progress: ${run.done} of ${run.total ?? '?'} sections written · next: ${run.label}${when}`
              : `${run.label}${when}`;
          work.dataset.tone = run.phase === 'failed' ? 'error' : 'info';
        }
        setLabel(runBtn, live && !run?.lockedBy ? 'Resume' : null);
        runBtn.disabled = run?.lockedBy === 'cron';
        discardBtn.hidden = !live;
        poll(Boolean(run?.lockedBy === 'cron'));
```

and add, above `refresh()`:

```ts
    /* While the schedule holds the run, the card re-reads it every twenty
       seconds so the owner watches it move; the timer clears itself when the
       panel is gone (the admin client-routes) or the run is no longer live. */
    let polling: ReturnType<typeof setInterval> | null = null;
    function poll(on: boolean) {
      if (!on && polling) {
        clearInterval(polling);
        polling = null;
      }
      if (on && !polling) {
        polling = setInterval(() => {
          if (!document.getElementById('dj-panel') || document.visibilityState !== 'visible') {
            clearInterval(polling!);
            polling = null;
            return;
          }
          void refresh();
        }, 20_000);
      }
    }
```

`work.dataset.tone` needs a style: add `#dj-work[data-tone='error'] { color: var(--color-accent-700); }` beside the `#dj-status` rule. The signed-out branch keeps disabling `runBtn`; add `discardBtn.hidden = true;` there.

- [ ] **Step 5: Browser check**

With the dev server up, save and run (scratchpad) `journal-run.mjs`: open `http://localhost:4321/admin/journal`, set the fake session, click the *Daily journal* tab, click *Run now*, wait 3 s, and assert: `#assist-dialog` is `open`, the log contains a message whose label reads `Planning the entry` (the local D1 has no provider, so the step ends with an error note — assert the note text is the endpoint's `No AI provider…` line and that the Run button reads *Run now* again). Then `POST /api/ai/runs` `discard` through the page (`fetch` with the fake token 401s locally — assert the two-click label change on Discard instead). Screenshot to the scratchpad and look at it.

Also run `npx astro check` (0 errors) — the `.astro` script blocks are typed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai-store.ts src/pages/admin/journal.astro src/components/DailyJournalPanel.astro
git commit -m "feat: Run now drives the daily post step by step in the assistant panel, with Resume and Discard"
```

---

### Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`, `.claude/rules/ai-assistant.md`, `.claude/rules/admin-surface.md`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-21-agent-runs-design.md` (status)

- [ ] **Step 1: `CLAUDE.md`**
  - `documents` bullet: add "…and, while a day's post is being written, that run's state (`run:journal-post:<day>` — decision 65)".
  - `journal` in the admin section: "two tabs: the manifest, and the daily journal's schedule in `DailyJournalPanel.astro`, whose Run now drives the post step by step in the assistant panel".
  - `check:ai` paragraph: add "that a run of steps advances, resumes, declines and fails as designed, and that a streamed step stores nothing when cancelled".

- [ ] **Step 2: `.claude/rules/ai-assistant.md`**
  - Add `src/lib/agent-runs.ts` and `src/lib/agent-runner.ts` to `paths`.
  - `ai.ts` paragraph: three sentences for B1–B3 (reasoning handed back only when received; `compactResults` before every later round; a non-streamed body read under the attempt timer and the completion's answer round on one attempt of grace).
  - New bullets: **`agent-runs.ts`** — *the run.* Pure; `nextStep`/`applyStep`/`failStep`/`assemblePost`/`summariseRun`; a failed step is counted, a finished one never redone, `NOTHING:` declines the day. **`agent-runner.ts`** — *advancing it.* `advance()` non-streamed for the tick, `advanceStreamed()` for the panel, the lock, `saveRun` after every step, one log row per step.
  - Endpoints: `/api/ai/daily` paragraph rewritten (loop, `in-progress`, `busy`, failures = attempts, `declined`); add `/api/ai/runs`.
  - The `check:ai` sentence: add the runner's pins.
  - `assist-tasks.ts`: twenty tasks; `journalplan`/`journalsection` are steps.

- [ ] **Step 3: `.claude/rules/admin-surface.md`** — the journal screen mounts the panel; the veil is `.admin-shell::after` and why; the Daily journal tab's Resume/Discard.

- [ ] **Step 4: `docs/DECISIONS.md`**
  - Decision 59: append "**Amended by decision 65.** The veil is drawn from `.admin-shell::after`, not `body::after`: `body > *` is a stacking context and a veil on `<body>` painted over the dialogs."
  - Decision 61: append "**Amended by decision 65.** The tick still does not stream, but it no longer makes one request: a run of non-streamed steps, each bounded end to end."
  - New **65. The daily post is a run of steps, and a step is the unit of retry** — Context (the two log rows, the veil), Decision (the run row, the steps, the lock, the tick loop, the panel's streamed step, reasoning passthrough, result trimming, the bounded body, the veil's parent), Consequences (`attempts` counts failed steps; a forced run's failures are the day's; a declined day is not retried), Rejected (a longer timeout — the body was 460 s and would be 900 tomorrow; streaming the tick — decision 61; generating in the runner — decision 52; an `ai_runs` table — a row a day with one reader is what `documents` is for; retrying a failed step inside the same tick — the next tick is the retry and costs nothing to wait for).

- [ ] **Step 5: `docs/FEATURES.md` and `CHANGELOG.md`** — Added: the run, `/api/ai/runs`, Resume/Discard, reasoning passthrough, result trimming. Fixed: the veil, the stalled body, the answer round's clock. Changed: `/api/ai/daily` answers `in-progress`; attempts count failed steps.

- [ ] **Step 6: Spec status** → `implemented (decision 65)`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md .claude/rules docs CHANGELOG.md
git commit -m "docs: decision 65 — the daily post is a run of steps; the veil, the runner and the runs endpoint"
```

---

### Task 12: Full verification and push

- [ ] **Step 1:** `npm run check` — every gate green, `ai: 223 checks passed`, `astro check` 0 errors.
- [ ] **Step 2:** `npm run build` — completes.
- [ ] **Step 3:** Browser pass (dev server): `veil.mjs` PASS on `/admin/projects` and on `/admin/journal/new` with the media library; `journal-run.mjs` PASS; screenshots inspected.
- [ ] **Step 4:** `git push -u origin fix/assist-long-runs`, then `gh pr create` with a body listing the four changes and the one thing not verified (`probe:ai`, dead local key). After merge and deploy: force a run from the Journal screen, read `wrangler d1 execute portfolio-content --remote --command "SELECT at, level, message FROM logs WHERE source='daily' ORDER BY id DESC LIMIT 12"` and confirm one row per step and a `Drafted` row.

---

## Phase 2 (a separate plan, after Phase 1 has drafted a real post)

1. Auto-compaction of a long conversation in `assist-panel.ts` (16 turns / 24,000 chars → the existing Compact, with a note).
2. The long case study as `kind: 'case-study'` on the runner: `agent-runs.ts` gains a second kind keyed by project slug with the existing `casestudyplan`/`casestudysection` tasks; `/api/ai/runs` accepts it with the owner's bearer token forwarded for repo lookups; `case-study-writer.ts` becomes a client of `runStep()`; the project page's Resume reads the row on load.
