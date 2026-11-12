#!/usr/bin/env node
/**
 * The third member of the `check:ai` / `probe:ai` family: score what a task
 * *wrote*, on fixtures, per model.
 *
 * `check:ai` is the gate and never touches a network. `probe:ai` proves the
 * wire is acceptable. Neither says whether a model's answer is any good — a
 * model swap is judged by reading a post. This runs each fixture through each
 * task's real prompt and reports the deterministic checks in a table, so two
 * models can be compared without reading their output.
 *
 * **Not in `npm run check`**: it needs `OPENROUTER_API_KEY` and costs cents.
 *
 *     npm run eval:ai -- --model openai/gpt-oss-20b --model anthropic/claude-haiku-4.5
 *     npm run eval:ai -- --model … --out eval-2026-11-11.json
 *
 * No judge model. Deterministic checks first; a second provider's opinion has
 * its own failure rate and is worth adding only when two models tie on every
 * column here and the owner still prefers one.
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const load = path => import(pathToFileURL(join(root, path)).href);

/* --- the key ------------------------------------------------------------ */

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
      '`npm run eval:ai` calls a real provider; `npm run check:ai` is the one that does not.',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const models = [];
const outs = [];
let out = '';
let details = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--model') models.push(argv[i + 1]);
  else if (argv[i] === '--out') out = argv[i + 1];
  else if (argv[i] === '--tasks') outs.push(argv[i + 1]);
  else if (argv[i] === '--details') details = true;
}
const MODEL_LIST = models.filter(Boolean).length
  ? models.filter(Boolean)
  : [env.EVAL_MODEL || 'openai/gpt-oss-20b'];
const ONLY = outs[0] ? new Set(outs[0].split(',').map(name => name.trim())) : null;

const { agentComplete, DEFAULTS } = await load('src/lib/ai.ts');
const { ASSIST_TASKS, buildAssistPrompt } = await load('src/lib/assist-tasks.ts');
const { validate: runValidators, OUTREACH_BANNED } = await load('src/lib/assist-validate.ts');
const { parseFit, scoreFromMarks, outreachInstruction, parseContact } = await load('src/lib/job-view.ts');

/* --- fixtures ----------------------------------------------------------- */

const fixture = name => readFileSync(join(here, 'eval-fixtures', name), 'utf8').trim();
const readmeA = fixture('readme-a.md');
const readmeB = fixture('readme-b.md');
const advertA = fixture('advert-a.md');
const advertB = fixture('advert-b.md');
const draftPost = fixture('draft-post.md');
const resume = fixture('resume.md');
const fit = fixture('fit.md');

const draftTitle = /^#\s+(.+)$/m.exec(draftPost)?.[1] ?? 'A draft';
const draftBody = draftPost.replace(/^#[^\n]*\n+/, '');
const contact = parseContact('Priya Nair — Technical Recruiter');

/**
 * One fixture against one task. Everything here is data the route would have
 * assembled — the point is to exercise the task's real prompt, not to model the
 * whole editor.
 */
function cases() {
  const list = [];
  for (const [name, readme] of [
    ['tracebox', readmeA],
    ['shelf', readmeB],
  ]) {
    list.push({
      task: 'project',
      fixture: name,
      context: { repo: `README:\n${readme}`, readme, title: name, summary: '' },
    });
    list.push({
      task: 'casestudyplan',
      fixture: name,
      context: {
        repo: `README:\n${readme}`,
        readme,
        title: name,
        summary: '',
        stack: 'Python, SQLite',
        highlights: '',
        problem: 'One box, one file, no sampling.',
        solution: 'A WAL and a per-trace index.',
        category: 'systems',
      },
    });
    list.push({
      task: 'casestudysection',
      fixture: name,
      context: {
        title: name,
        summary: '',
        stack: 'Python, SQLite',
        problem: 'One box, one file, no sampling.',
        solution: 'A WAL and a per-trace index.',
        facts: readme.split('\n').filter(line => line.startsWith('- ')).join('\n') || '- one fact',
        outline: '1. Architecture at a glance\n2. What was hard',
        section: '## Architecture at a glance\nCovers: the components and the flow.\nLength: about 300 words. Write only this section.',
        previous: '',
      },
    });
    list.push({
      task: 'diagram',
      fixture: name,
      context: { readme, title: name, summary: '', body: readme, selection: '' },
    });
  }
  list.push({
    task: 'compose',
    fixture: 'cache-key',
    context: { title: draftTitle, summary: '', tags: '', body: draftBody },
  });
  for (const [name, advert] of [
    ['northwind', advertA],
    ['cobalt', advertB],
  ]) {
    list.push({
      task: 'jobFit',
      fixture: name,
      context: { resume, jobDescription: advert, fit: '' },
    });
    list.push({
      task: 'jobOutreach',
      fixture: name,
      context: {
        resume,
        jobDescription: advert,
        fit,
        contacts: 'Priya Nair — Technical Recruiter',
      },
      instruction: outreachInstruction(contact, 'message', undefined, {
        ask: 'process',
        tone: 'direct',
      }),
    });
  }
  return ONLY ? list.filter(item => ONLY.has(item.task)) : list;
}

/* --- running ------------------------------------------------------------ */

const provider = model => ({
  slug: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: key,
  model,
  assistModel: null,
  fallbackModels: [],
  params: {},
  maxOutputTokens: null,
  pricePrompt: null,
  priceCompletion: null,
  reasoningEffort: DEFAULTS.reasoningEffort,
  promptCache: true,
  toolsEnabled: true,
  active: true,
  priority: 10,
  updatedAt: new Date().toISOString(),
});

function validatorContext(taskName, task, answer) {
  const shape = task.keys
    ? {
        labels: [...task.keys.head, task.keys.tail].map(spec => spec.label),
        required: task.keys.head.slice(0, 2).map(spec => spec.label),
        tail: task.keys.tail.label,
      }
    : undefined;
  let channel;
  if (taskName === 'jobOutreach') {
    channel = { label: 'Message', limit: 600, unit: 'characters', expect: 2 };
  }
  return {
    shape,
    slugs: ['tracebox', 'shelf'],
    channel,
    banned: task.validators?.includes('banned') ? OUTREACH_BANNED : undefined,
    expectedScore: task.validators?.includes('fitScore')
      ? scoreFromMarks(parseFit(answer))
      : undefined,
  };
}

const rows = [];
const started = Date.now();

for (const model of MODEL_LIST) {
  for (const item of cases()) {
    const task = ASSIST_TASKS[item.task];
    const { messages } = buildAssistPrompt(task, {
      ownerName: 'Anish',
      context: item.context,
      instruction: item.instruction ?? '',
      corpus: '',
      persona: '',
    });
    const at = Date.now();
    try {
      let lastFindings = [];
      const done = await agentComplete({
        providers: [provider(model)],
        which: 'assist',
        call: {
          maxTokens: task.maxTokens,
          temperature: task.temperature,
          stream: false,
          timeoutMs: 120_000,
          deadline: Date.now() + 180_000,
          effort: 'low',
        },
        messages,
        runTool: async () => ({ ok: false, text: 'Eval runs no lookups.', detail: 'none' }),
        validate: (answer, stopReason) => {
          const names = [...(task.validators ?? []), 'truncated'];
          lastFindings = runValidators(names, answer, { ...validatorContext(item.task, task, answer), stopReason });
          return lastFindings;
        },
      });
      const findings = lastFindings.map(finding => finding.code);
      rows.push({
        model,
        fixture: item.fixture,
        task: item.task,
        pass: findings.length === 0,
        findings,
        messages: lastFindings.map(finding => finding.message),
        repaired: done.repaired ?? null,
        chars: done.text.length,
        thinking: done.reasoning.length,
        rounds: done.rounds,
        calls: done.calls,
        ms: Date.now() - at,
        usage: done.usage ?? null,
      });
      process.stdout.write(
        `. ${model} · ${item.task} · ${item.fixture}${findings.length ? ` · ${findings.join(',')}` : ''}\n`,
      );
      if (details && findings.length) {
        process.stdout.write(
          `\n--- ${item.task} · ${item.fixture} ---\n${lastFindings
            .map(finding => `  ${finding.code}: ${finding.message}`)
            .join('\n')}\n${done.text}\n--- end ---\n\n`,
        );
      }
    } catch (error) {
      rows.push({
        model,
        fixture: item.fixture,
        task: item.task,
        pass: false,
        findings: ['provider'],
        repaired: null,
        chars: 0,
        thinking: 0,
        rounds: 0,
        calls: 0,
        ms: Date.now() - at,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`! ${model} · ${item.task} · ${item.fixture} · ${error.message}\n`);
    }
  }
}

/* --- the table ---------------------------------------------------------- */

const width = (value, n) => String(value).padEnd(n);
const header = ['model', 'fixture', 'task', 'check', 'repaired', 'chars', 'think', 'rounds', 'calls', 'ms', 'tokens'];
const lines = [
  header.map((cell, i) => width(cell, [30, 10, 16, 18, 8, 7, 7, 6, 5, 7, 14][i])).join(' '),
  header.map((_, i) => '-'.repeat([30, 10, 16, 18, 8, 7, 7, 6, 5, 7, 14][i])).join(' '),
];
for (const row of rows) {
  const check = row.pass ? 'ok' : row.findings.join(',');
  lines.push(
    [
      width(row.model.slice(0, 30), 30),
      width(row.fixture, 10),
      width(row.task, 16),
      width(check.slice(0, 18), 18),
      width(row.repaired ? 'yes' : '-', 8),
      width(row.chars, 7),
      width(row.thinking, 7),
      width(row.rounds, 6),
      width(row.calls, 5),
      width(row.ms, 7),
      width(row.usage ? `${row.usage.prompt}/${row.usage.completion}` : '-', 14),
    ].join(' '),
  );
}
process.stdout.write(`\n${lines.join('\n')}\n`);
process.stdout.write(
  `\n${rows.filter(row => row.pass).length}/${rows.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s\n`,
);
if (rows.some(row => !row.pass)) process.exitCode = 1;

if (out) {
  const path = resolve(process.cwd(), out);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), models: MODEL_LIST, rows }, null, 2)}\n`);
  process.stdout.write(`Wrote ${path}\n`);
}
