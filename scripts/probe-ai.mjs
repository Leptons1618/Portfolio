#!/usr/bin/env node
/**
 * The AI pipeline, against a real provider.
 *
 * `scripts/test-ai.mjs` is the gate and it never touches a network: it proves
 * the key cannot leak, the corpus cannot carry a draft, the loop terminates.
 * None of that says the request body this repository builds is one a vendor
 * accepts, and that is a different kind of failure — it does not show up in
 * `npm run check`, it shows up as a visitor being told the assistant could not
 * answer.
 *
 * So this is the other half, and it is deliberately **not** in `npm run check`:
 * it needs a credential, it costs a fraction of a cent, and CI has neither. Run
 * it by hand after changing anything in `ai.ts`, `ai-catalog.ts` or `ai-tools.ts`:
 *
 *     npm run probe:ai                  # the model on the row's defaults
 *     npm run probe:ai -- --model x/y   # one specific model
 *
 * The key comes from `.env` — the same file `astro dev` reads — and is never
 * printed. What it exercises, in order:
 *
 *   1. `GET /models` through `normaliseModels()`. The listing shape is a third
 *      party's and changes without notice; this is what says whether the picker
 *      would still have anything in it.
 *   2. A non-streaming `callChat`, which is the shortest path to "is the body
 *      we build acceptable".
 *   3. A streaming `callChat` through `agentStream`, with the real tool table
 *      and a stub tool runner. This is the one that matters: it drives the
 *      frame protocol, the `<think>` splitter, the tool loop and its bounds.
 *
 * The last one prints the **split between thinking and answer**, because that
 * is the number the settings screen is actually about — a run that spends its
 * whole ceiling deliberating and truncates mid-sentence looks, from every other
 * angle, like a working call.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const load = path => import(pathToFileURL(join(root, path)).href);

/* --- the key ------------------------------------------------------------ */

/**
 * `.env`, read the way `astro dev` reads it and no further.
 *
 * Not `dotenv`: this needs `KEY=value` and nothing else, and a dependency that
 * only a hand-run script imports is a dependency in everybody's lockfile.
 * Environment wins, so CI or a shell export can drive this without a file.
 */
function envFile() {
  const out = {};
  let text = '';
  try {
    text = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...envFile(), ...process.env };
const key = env.OPENROUTER_API_KEY;

if (!key) {
  console.error(
    'No OPENROUTER_API_KEY, in the environment or in .env.\n' +
      'This probe calls a real provider; `npm run check` is the one that does not.',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = name => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};

/* --- the modules under test --------------------------------------------- */

const { callChat, agentStream, effectiveMaxTokens, THINKING_HEADROOM, DEFAULTS } =
  await load('src/lib/ai.ts');
const { normaliseModels, presetForUrl } = await load('src/lib/ai-catalog.ts');
const { TOOL_SPECS, toolsFor, toolSummary } = await load('src/lib/ai-tools.ts');

const BASE_URL = 'https://openrouter.ai/api/v1';
/* Free, function-calling, and it takes `reasoning_effort` — all three, because
   a probe on a model that never thinks measures none of what this is for. It is
   also the model the thinking-leak work was done against: it narrates at length
   in `content` where no tag marks it, which is the case `thinkStripper()`
   exists for and the one a quieter model would not exercise.

   Deliberately the *paid* row rather than `:free`. Every free model on this
   router is rate-limited upstream, so a probe pointed at one reports 429 far
   more often than it reports anything about this repository — which is the one
   thing a diagnostic must not do. The whole run is a few hundred tokens at
   $0.03/$0.13 per million; it costs less than a hundredth of a cent.

   Overridable, and expect to override it: model ids are retired, and the step
   above will say so by name when this one is. */
const MODEL = flag('model') ?? 'openai/gpt-oss-20b';

/** A `Provider` exactly as `toProvider()` would have built it from a row. */
const provider = {
  slug: 'openrouter',
  label: 'OpenRouter',
  baseUrl: BASE_URL,
  apiKey: key,
  model: MODEL,
  assistModel: null,
  fallbackModels: [],
  params: {},
  maxOutputTokens: null,
  reasoningEffort: DEFAULTS.reasoningEffort,
  promptCache: true,
  toolsEnabled: true,
  active: true,
  priority: 10,
  updatedAt: new Date().toISOString(),
};

let failures = 0;
const step = name => process.stdout.write(`\n— ${name}\n`);
const ok = detail => process.stdout.write(`  ok  ${detail}\n`);
const bad = detail => {
  failures += 1;
  process.stdout.write(`  FAIL  ${detail}\n`);
};

async function probe(name, run) {
  step(name);
  try {
    await run();
  } catch (error) {
    bad(error.message);
  }
}

/* --- 1. the catalogue ---------------------------------------------------- */

await probe('the model listing still parses', async () => {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  assert.ok(response.ok, `GET /models answered ${response.status}`);

  const models = normaliseModels(await response.json());
  assert.ok(models.length > 0, 'the listing produced no models at all');
  ok(`${models.length} models`);

  const priced = models.filter(m => m.promptPrice !== null);
  assert.ok(priced.length > 0, 'no model carried a price, so the picker shows none');
  ok(`${priced.length} carry a price, ${models.filter(m => m.free).length} are free`);

  const ceilinged = models.filter(m => m.maxOutput !== null);
  ok(`${ceilinged.length} report a max completion — that column is what raises a task ceiling`);

  const chosen = models.find(m => m.id === MODEL);
  if (chosen) ok(`${MODEL}: ctx ${chosen.contextLength ?? '?'}, max out ${chosen.maxOutput ?? '?'}`);
  else bad(`${MODEL} is not in the listing — pass --model with one that is`);

  assert.equal(presetForUrl(BASE_URL)?.id, 'openrouter', 'the base URL no longer finds its preset');
  ok('the base URL still resolves to the OpenRouter preset');
});

/* --- 2. the plain call --------------------------------------------------- */

await probe('a non-streaming call is a body the vendor accepts', async () => {
  const { response, provider: answered } = await callChat([provider], {
    messages: [
      { role: 'system', content: 'Answer in exactly one short sentence.' },
      { role: 'user', content: 'What is the capital of France?' },
    ],
    maxTokens: 400,
    temperature: 0.2,
    effort: 'low',
  });

  assert.ok(response.ok, `the provider answered ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content ?? '';
  assert.ok(text.trim(), 'the model returned an empty message');
  ok(`${answered.model} answered: ${JSON.stringify(text.trim().slice(0, 80))}`);
  if (payload.usage) {
    ok(`usage: ${payload.usage.prompt_tokens} in, ${payload.usage.completion_tokens} out`);
  }
});

/* --- 3. the stream, the splitter and the loop ---------------------------- */

/**
 * A stub tool runner, so the loop can be driven without a database.
 *
 * The real one needs D1 and the real one is what `check:ai` covers. What is
 * being measured here is the round trip: that a vendor accepts the `tools`
 * field this repo builds, emits a `tool_calls` delta the re-encoder can
 * assemble, and accepts the `tool` messages sent back.
 *
 * It returns a **`ToolOutcome`** — `{ ok, text, detail }` — and not a string.
 * That is the contract `agentLines` reads, and a stub returning a bare string
 * puts `undefined` in the `tool` message: the loop runs, every frame arrives,
 * and the model answers that it could not find anything. Which is exactly what
 * this probe reported the first time it ran, and is the shape of failure it is
 * here to catch.
 */
const stubTool = async (name, args) => {
  if (name === 'read_post') {
    return {
      ok: true,
      text: `# On shipping\n\nA post arguing that finishing is the hard part. Slug: ${args.slug ?? '?'}.`,
      detail: args.slug ?? '',
    };
  }
  return { ok: false, text: `No result for ${name}.`, detail: 'not found' };
};

await probe('a streamed answer splits thinking from prose', async () => {
  const tools = toolsFor('chat');
  assert.ok(tools.length, 'the chat surface was offered no tools');
  ok(`${tools.length} of ${Object.keys(TOOL_SPECS).length} tools offered to the chat surface`);

  const messages = [
    {
      role: 'system',
      content:
        'You answer questions about a portfolio site.\n' +
        toolSummary('chat') +
        '\nThe site has one post with the slug "on-shipping".',
      cache: true,
    },
    { role: 'user', content: 'What is the post "on-shipping" about? One sentence.' },
  ];

  const call = { maxTokens: 1500, temperature: 0.2, effort: 'low', stream: true, tools };
  const first = await callChat([provider], { ...call, messages });
  assert.ok(first.response.ok, `the provider answered ${first.response.status}`);
  assert.ok(first.response.body, 'the provider returned no body to stream');

  const stream = agentStream({
    first,
    which: 'chat',
    call,
    messages,
    runTool: stubTool,
    maxRounds: 2,
    maxCalls: 4,
  });

  let answer = '';
  let thinking = '';
  const lookups = [];
  let done = false;
  let error = '';

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (typeof frame.delta === 'string') answer += frame.delta;
      if (typeof frame.thinking === 'string') thinking += frame.thinking;
      /* Two frames per call — `running` carries the arguments, `done` carries
         the outcome and the elapsed time, and a surface updates the row in
         place by `id`. Printed as one line each so the pairing is visible;
         `id: 'limit'` is the loop announcing that it has stopped granting
         lookups, which is a real frame and not a call. */
      if (frame.tool) {
        const t = frame.tool;
        lookups.push(
          t.status === 'running'
            ? `${t.name}(${JSON.stringify(t.args ?? {})}) …`
            : `${t.name} → ${t.status}${t.detail ? ` (${t.detail})` : ''}${t.ms ? ` ${t.ms}ms` : ''}`,
        );
      }
      if (frame.error) error = frame.error;
      if (frame.done) done = true;
    }
  }

  if (error) bad(`the stream carried an error frame: ${error}`);
  assert.ok(done, 'the stream ended without a done frame');
  ok('the stream terminated with a done frame');

  for (const row of lookups) ok(`lookup: ${row}`);

  assert.ok(answer.trim(), 'the answer channel was empty — every token went somewhere else');
  const total = answer.length + thinking.length;
  const share = total ? Math.round((thinking.length / total) * 100) : 0;
  ok(`answer ${answer.length} chars, thinking ${thinking.length} chars (${share}% thinking)`);
  ok(`answer: ${JSON.stringify(answer.trim().slice(0, 120))}`);

  /* The failure this whole probe exists for. A model that spends its budget
     deliberating truncates the answer, and every other signal — 200, a stream,
     frames arriving — says the call worked. */
  if (share > 70) {
    bad(`${share}% of the response was thinking; the ceiling is being spent before the answer`);
  }
  /* And no leakage across the channels, which is the guarantee decision 29
     rests on. `<think>` in the answer means the splitter missed a shape. */
  if (/<\/?(?:think|thinking|reasoning|analysis)>/i.test(answer)) {
    bad('a reasoning tag reached the answer channel');
  }
});

/* --- 4. the ceiling rule, against this model's real numbers -------------- */

await probe('the ceiling rule holds against the vendor’s own numbers', async () => {
  /* Not a network call — an assertion about what the two previous ones imply.
     A model reporting a 32k completion must not lift a 600-token task to 32k,
     and a 4,000-token task must not have to write its answer out of the same
     budget it deliberated with. This is the arithmetic that says so. */
  const rich = { ...provider, maxOutputTokens: 32_000 };
  assert.equal(effectiveMaxTokens(rich, 600), 1200);
  assert.equal(effectiveMaxTokens(rich, 4000), 4000 + THINKING_HEADROOM);
  assert.equal(effectiveMaxTokens(rich, 12_000), 12_000 + THINKING_HEADROOM);
  assert.equal(effectiveMaxTokens({ ...provider, maxOutputTokens: null }, 600), 1200);
  ok(`a task keeps its answer budget and gets up to ${THINKING_HEADROOM} more to think in`);
});

process.stdout.write(
  failures ? `\n${failures} probe(s) failed.\n` : '\nThe pipeline answered end to end.\n',
);
process.exitCode = failures ? 1 : 0;
