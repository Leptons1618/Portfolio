/**
 * Self-test for `cli/portfolio.mjs`.
 *
 * The CLI's whole safety story is that it is *just another caller* of
 * `POST /api/content` — so the endpoint's own tests cover the boundary and there
 * is nothing to re-prove here. What is only true of this file is the translation
 * layer either side of that call, and all of it is a pure function:
 *
 *   - a `field=value` pair becomes the value the column's encoder expects,
 *   - a row read back is projected onto the fields a write will take,
 *   - and the origin it talks to is the one `public/CNAME` names.
 *
 * Each one fails silently if it drifts. A `list` field parsed as a string would
 * store `"cv,pytorch"` as a one-element array and the tags would render as one
 * tag; a derived key left in place would make `edit` a 400 on every provider; a
 * hard-coded origin would point a signed-in tool at the wrong site. None of
 * those is a crash.
 *
 * Plain `node:assert`, like every other check here. It imports the CLI, which is
 * why that file guards its `main()` — see the bottom of it.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defaultSite, kindOf, parsePair, writable } from '../cli/portfolio.mjs';
import { BadRequest, TABLES } from '../src/lib/content-schema.ts';
import {
  boardUrl,
  htmlToText,
  matches,
  parseBoardLine,
  postingSlug,
  readBoard,
  readWatchlist,
} from '../src/lib/job-boards.ts';
import {
  OUTREACH_CHANNELS,
  formatContact,
  formatOutreach,
  measure,
  nextAction,
  outreachInstruction,
  parseContact,
  parseFit,
  parseOutreach,
  peopleSearches,
  scoreFromMarks,
  splitSubject,
  workingDaysAfter,
} from '../src/lib/job-view.ts';

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  process.stdout.write(`  ok  ${name}\n`);
};

/* ---------- kinds ---------- */

check('every kind resolves to a table the endpoint knows', () => {
  for (const [typed, table] of [
    ['project', 'projects'],
    ['projects', 'projects'],
    ['case-study', 'case_studies'],
    ['cs', 'case_studies'],
    ['post', 'journal'],
    ['journal', 'journal'],
    ['provider', 'ai_providers'],
    ['doc', 'documents'],
    ['application', 'applications'],
    ['job', 'applications'],
    ['PROJECT', 'projects'],
  ]) {
    assert.equal(kindOf(typed), table, `${typed} → ${table}`);
    assert.ok(table in TABLES, `${table} is a real table`);
  }
});

check('an unknown kind is refused with the list', () => {
  assert.throws(() => kindOf('widget'), /Unknown kind/);
  assert.throws(() => kindOf(undefined), /Unknown kind/);
});

/* ---------- field=value ---------- */

check('a value is parsed against the encoder its column declares', () => {
  // The bug this prevents: a list stored as one string, rendering as one tag.
  assert.deepEqual(parsePair('projects', 'tags=cv,pytorch'), ['tags', ['cv', 'pytorch']]);
  assert.deepEqual(parsePair('projects', 'tags= cv , pytorch ')[1], ['cv', 'pytorch']);
  assert.deepEqual(parsePair('projects', 'year=2026'), ['year', 2026]);
  assert.equal(typeof parsePair('projects', 'year=2026')[1], 'number');
  assert.deepEqual(parsePair('projects', 'hidden=true'), ['hidden', true]);
  assert.deepEqual(parsePair('projects', 'hidden=no'), ['hidden', false]);
  assert.deepEqual(parsePair('projects', 'title=A Thing'), ['title', 'A Thing']);
  // A value containing `=` keeps all of it: only the first one splits.
  assert.deepEqual(parsePair('projects', 'demoUrl=https://x.test/?a=1'), ['demoUrl', 'https://x.test/?a=1']);
});

check('`-` clears a field, and an accidental empty value does not', () => {
  /* `field=` is one keystroke from `field=x` and clearing a column by accident
     is silent. `-` is the deliberate form; an empty string stays an empty
     string, which the server treats as unset for text but which the author
     typed on purpose. */
  assert.deepEqual(parsePair('projects', 'demoUrl=-'), ['demoUrl', '']);
  assert.deepEqual(parsePair('projects', 'tags=-'), ['tags', []]);
  assert.deepEqual(parsePair('projects', 'demoUrl='), ['demoUrl', '']);
});

check('a wrong field name is caught here rather than round-tripped', () => {
  assert.throws(() => parsePair('projects', 'repo_url=x'), /Unknown field "repo_url"/);
  assert.throws(() => parsePair('projects', 'repo_url=x'), /repoUrl/, 'and the real list is printed');
  assert.throws(() => parsePair('projects', 'title'), /Expected field=value/);
  assert.throws(() => parsePair('projects', '=x'), /Expected field=value/);
});

check('a value the column cannot hold is refused before the request', () => {
  assert.throws(() => parsePair('projects', 'year=soon'), /wants a number/);
  assert.throws(() => parsePair('projects', 'hidden=maybe'), /wants true or false/);
});

/* ---------- read → write ---------- */

check('a provider read back is projected onto what a write takes', () => {
  /* `summarise()` adds three keys a write refuses — `slug`, `hasKey`, `keyHint`
     — so `edit provider` would 400 on every row without this. And it must not
     invent `apiKey`: the key is never read back, and sending one derived from a
     fingerprint would overwrite the real credential with a masked string. */
  const fromServer = {
    slug: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-haiku',
    active: true,
    priority: 10,
    updatedAt: '2026-09-29 00:00:00',
    hasKey: true,
    keyHint: 'sk-o…cdef',
    params: { temperature: 0.7 },
  };
  const fields = writable('ai_providers', fromServer);
  for (const derived of ['slug', 'updatedAt', 'hasKey', 'keyHint']) {
    assert.ok(!(derived in fields), `${derived} is not a writable field`);
  }
  assert.ok(!('apiKey' in fields), 'a read never produces a key to write back');
  assert.equal(fields.label, 'OpenRouter');
  // `params` is a `text` column holding JSON; an object would become
  // "[object Object]" through `encode`.
  assert.equal(fields.params, '{"temperature":0.7}');
});

check('every key a projection keeps is one the endpoint would bind', () => {
  for (const table of Object.keys(TABLES)) {
    const everything = Object.fromEntries([
      ...Object.keys(TABLES[table].columns).map(field => [field, 'x']),
      ['slug', 'x'],
      ['updatedAt', 'x'],
      ['nonsense', 'x'],
    ]);
    const kept = Object.keys(writable(table, everything));
    assert.deepEqual(kept.sort(), Object.keys(TABLES[table].columns).sort(), `${table} keeps exactly its fields`);
  }
});

/* ---------- login must not block on a pipe ---------- */

/**
 * `login --token X` has to finish without reading stdin.
 *
 * It did not. The token was resolved as `flags.token || (await stdin()) || …`,
 * and `await stdin()` on a non-TTY waits for an EOF that a script, a CI job or an
 * agent's shell never sends — so `portfolio login --token …` sat there with no
 * output and no error, looking like a network hang. The flag has to be checked
 * before the pipe is touched.
 *
 * The assertion is only that it *terminates*: what it says depends on whether
 * GitHub is reachable, and a test that needed a particular answer would be a test
 * that fails on a train. A hang is the bug; any exit is the fix.
 */
await new Promise((resolve, reject) => {
  const cli = fileURLToPath(new URL('../cli/portfolio.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, 'login', '--token', 'not-a-real-token'], {
    /* An open pipe nobody writes to and nobody closes — exactly the shape the
       bug needed. Leaving it open is the point; do not end it. */
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, PORTFOLIO_SITE: 'http://127.0.0.1:9', XDG_CONFIG_HOME: '/dev/null/nope' },
  });
  const deadline = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('`login --token` did not exit: it is reading stdin again'));
  }, 20_000);
  child.on('exit', () => {
    clearTimeout(deadline);
    checks += 1;
    process.stdout.write('  ok  `login --token` exits without waiting on stdin\n');
    resolve();
  });
});

/* ---------- the origin ---------- */

check('the origin comes from public/CNAME rather than a fourth copy of it', () => {
  /* `check-content.mjs` keeps `public/CNAME`, `astro.config.mjs` and `site.ts`
     in agreement. A literal here would be a fourth place to disagree, and the
     symptom would be a signed-in tool writing to the wrong site. */
  const cname = readFileSync(new URL('../public/CNAME', import.meta.url), 'utf8').trim();
  assert.equal(defaultSite(), `https://${cname}`);
});

/* ---------- the boundary is shared, not reimplemented ---------- */

check('the toolchain reuses the endpoint’s own field map', () => {
  /* The property that makes these files short: there is no field table anywhere
     in the toolchain. If one ever appears, this is the check that should start
     failing — and it reads all three files, because a column name moving from one
     to another must not be how the guard stops guarding. */
  const files = ['../cli/portfolio.mjs', '../cli/portfolio-api.mjs', '../mcp/portfolio-mcp.mjs'];
  /* Comments stripped first, the same way `check-content.mjs` strips them: these
     files *explain* the rule, and the explanation quotes the column name it is
     about. A matcher that reads prose reports the documentation as the bug. */
  const strip = source => source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const sources = files.map(file => readFileSync(new URL(file, import.meta.url), 'utf8'));
  const all = sources.map(strip).join('\n');

  assert.match(all, /from '\.\.\/src\/lib\/content-schema\.ts'/, 'the allowlist is imported, not restated');
  assert.doesNotMatch(all, /\brepo_url\b|\bcase_study_slug\b|\bfeatured_rank\b/, 'no column names of its own');

  /* Four endpoints across the whole toolchain, and none of them a second writer:
     `POST /api/content` is the only thing that writes a content row, here as in
     the browser. A fifth path appearing is the thing worth noticing. */
  const endpoints = [...all.matchAll(/['"`](\/api\/[a-z/]+)/g)].map(m => m[1]);
  assert.deepEqual(
    [...new Set(endpoints)].sort(),
    ['/api/ai/providers', '/api/content', '/api/logs', '/api/media'],
    'four endpoints, and none of them a second writer',
  );

  /* And the MCP server must not have grown its own way to reach the database or a
     Cloudflare credential: it is a client of the same four, with a policy layer. */
  const mcp = sources[2];
  assert.doesNotMatch(mcp, /D1Database|wrangler|CLOUDFLARE_/, 'the MCP server has no database access');
  assert.match(mcp, /assertWritable/, 'and it gates writes before they reach the network');
});

/* ---------- job boards ---------- */

/* Fixtures in the shape each vendor actually answers — read off the live
   endpoints, cut down to the fields that are read. */
const GREENHOUSE = {
  jobs: [
    {
      title: 'Backend Engineer',
      absolute_url: 'https://example.com/jobs?gh_jid=1',
      location: { name: 'Bengaluru, India' },
      content: '&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;Build &amp;amp; run APIs.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;Postgres&lt;/li&gt;&lt;/ul&gt;',
    },
    { title: '', absolute_url: 'https://example.com/jobs?gh_jid=2', location: null, content: '' },
  ],
  meta: { total: 2 },
};
const LEVER = [
  {
    text: 'Platform Engineer',
    hostedUrl: 'https://jobs.lever.co/acme/abc',
    categories: { location: 'Remote', allLocations: ['Remote', 'Bangalore'] },
    descriptionPlain: 'We run the platform.',
    lists: [{ text: 'What you will do', content: '<li>Own the cluster</li><li>Write Terraform</li>' }],
    additionalPlain: 'Equal opportunity.',
  },
];
const ASHBY = {
  jobs: [
    {
      title: 'ML Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/acme/1',
      location: 'San Francisco',
      secondaryLocations: [{ location: 'London, UK' }],
      isRemote: true,
      isListed: true,
      descriptionPlain: 'Train models.',
    },
    { title: 'Hidden', jobUrl: 'https://jobs.ashbyhq.com/acme/2', isListed: false, descriptionPlain: 'x' },
  ],
};

check('each board is read into the fields an application takes', () => {
  const [gh, ...rest] = readBoard({ kind: 'greenhouse', token: 'acme', company: 'Acme' }, GREENHOUSE);
  assert.equal(rest.length, 0, 'a posting with no title is dropped, not tracked');
  assert.deepEqual(
    { company: gh.company, role: gh.role, url: gh.url, location: gh.location },
    { company: 'Acme', role: 'Backend Engineer', url: 'https://example.com/jobs?gh_jid=1', location: 'Bengaluru, India' },
  );
  /* Greenhouse escapes its HTML once, so an ampersand in the prose arrives
     escaped twice and has to come out as one. */
  assert.equal(gh.description, 'About\nBuild & run APIs.\n\n- Go\n- Postgres');

  const [lever] = readBoard({ kind: 'lever', token: 'acme' }, LEVER);
  assert.equal(lever.company, 'acme', 'the board name stands in for a missing company');
  assert.equal(lever.location, 'Remote / Bangalore', 'locations are joined without repeats');
  assert.match(lever.description, /We run the platform\.\n\nWhat you will do\n- Own the cluster\n- Write Terraform\n\nEqual opportunity\./);

  const ashby = readBoard({ kind: 'ashby', token: 'acme' }, ASHBY);
  assert.equal(ashby.length, 1, 'an unlisted posting is not offered');
  assert.equal(ashby[0].location, 'San Francisco / London, UK / Remote');
});

check('a board’s link is http(s) or nothing — it becomes an href beside the token', () => {
  for (const url of ['javascript:alert(document.cookie)', 'JaVaScRiPt:x', 'data:text/html,x', '//evil.example', ' ']) {
    assert.deepEqual(readBoard({ kind: 'ashby', token: 'a' }, { jobs: [{ title: 'Engineer', jobUrl: url }] }), []);
  }
  assert.equal(readBoard({ kind: 'lever', token: 'a' }, [{ text: 'Engineer', hostedUrl: ' HTTPS://x.example/1 ' }])[0].url, 'HTTPS://x.example/1');
});

check('a third party’s garbage is an empty list, not a throw', () => {
  for (const kind of ['greenhouse', 'lever', 'ashby']) {
    for (const junk of [null, 'x', 7, {}, { jobs: 'no' }, [null, 3]]) {
      assert.deepEqual(readBoard({ kind, token: 'a' }, junk), []);
    }
  }
});

check('a board name cannot become anything but one path segment', () => {
  assert.equal(boardUrl({ kind: 'lever', token: 'acme' }), 'https://api.lever.co/v0/postings/acme?mode=json');
  for (const token of ['../admin', 'a/b', 'a?x=1', '', ' acme', '.hidden']) {
    assert.throws(() => boardUrl({ kind: 'greenhouse', token }), /not a board name/);
  }
  assert.throws(() => boardUrl({ kind: 'linkedin', token: 'acme' }), /not a board this reads/);
});

check('a stored watchlist is rebuilt rather than trusted', () => {
  const list = readWatchlist({
    boards: [
      { kind: 'greenhouse', token: 'stripe', company: ' Stripe ' },
      { kind: 'linkedin', token: 'acme' },
      { kind: 'lever', token: '../x' },
      'nonsense',
    ],
    keywords: ['engineer', '  ', ''],
    exclude: 'intern',
  });
  assert.deepEqual(list.boards, [{ kind: 'greenhouse', token: 'stripe', company: 'Stripe' }]);
  assert.deepEqual(list.keywords, ['engineer'], 'a blank keyword would otherwise match nothing');
  assert.deepEqual(list.exclude, []);
  assert.deepEqual(readWatchlist('not json').boards, []);
  assert.deepEqual(readWatchlist(JSON.stringify({ boards: [{ kind: 'ashby', token: 'openai' }] })).boards, [
    { kind: 'ashby', token: 'openai' },
  ]);
});

check('a board line reads kind, name, then the company as written', () => {
  assert.deepEqual(parseBoardLine('Greenhouse  stripe  Stripe Inc'), { kind: 'greenhouse', token: 'stripe', company: 'Stripe Inc' });
  assert.deepEqual(parseBoardLine('lever palantir'), { kind: 'lever', token: 'palantir' });
  assert.equal(parseBoardLine('workday acme'), null);
  assert.equal(parseBoardLine('ashby'), null);
});

check('matching is title against keywords and exclusions, location against locations', () => {
  const list = readWatchlist({ keywords: ['engineer'], exclude: ['intern'], locations: ['bangalore', 'remote'] });
  const posting = { company: 'A', role: 'Senior Engineer', url: 'u', location: 'Remote / Bangalore', description: '' };
  assert.ok(matches(posting, list));
  assert.ok(!matches({ ...posting, role: 'Engineering Intern' }, list), 'an exclusion wins');
  assert.ok(!matches({ ...posting, role: 'Designer' }, list));
  assert.ok(!matches({ ...posting, location: 'Dublin' }, list));
  assert.ok(matches({ ...posting, role: 'Designer', location: 'Dublin' }, readWatchlist({})), 'an empty list matches all');
});

check('a posting slug is the write endpoint’s shape and never collides', () => {
  const taken = new Set(['acme-backend-engineer']);
  const slug = postingSlug({ company: 'Acme', role: 'Backend Engineer' }, taken);
  assert.equal(slug, 'acme-backend-engineer-2');
  assert.ok(taken.has(slug), 'it joins the set, so the next one is -3');
  assert.equal(postingSlug({ company: 'Acme', role: 'Backend Engineer' }, taken), 'acme-backend-engineer-3');
  for (const role of ['Señor Ingeniero (Go) — Plataforma', '!!!', 'x'.repeat(200)]) {
    assert.match(postingSlug({ company: 'Café', role }, new Set()), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

check('advert HTML reads as text, and a script body does not survive', () => {
  assert.equal(htmlToText('<p>One&nbsp;two<br>three &#8212; &#x2013;</p><script>alert(1)</script>'), 'One two\nthree — –');
});

/* ---------- job view: the fit assessment ---------- */

/* The template `jobFit` asks for, filled in. */
const FIT_TEMPLATE = `**Verdict:** Reasonable — the stack matches, the domain does not.
**Score:** 6/10 — mostly from the must-haves.

### Must-haves
- ✅ **TypeScript** — five years across two roles
- ⚠️ Kubernetes — adjacent: Docker on ECS
- ❌ Rust — nothing in the record

### Nice-to-haves
- ✅ Design systems — built the admin surface

### Gaps worth closing
- Add the MCP server to the resume's project list.
- Write up the edge-cache work.

### Keywords for the ATS
True and missing: edge computing, D1, Workers.

### Resume
Backend, fintech.`;

/* What a model working through the `jobs` skill actually wrote: bold
   requirements, an em dash inside one, ⚠ with and without U+FE0F, a
   continuation line, a keywords lead-in, and sections the template never
   named. */
const FIT_REAL = `**Verdict:** Stretch — strong systems record, no ML production.
**Score:** 5/10 — must-haves are half met.

### Must haves
- ✅ **AI-native — orchestrate agents** — not "uses AI tools", but shipped tool loops
  and an evaluation harness.
- ⚠️ **Kubernetes in production** — adjacent: Docker on ECS at Acme. Say adjacent.
- ⚠ **Go** — adjacent: wrote the CLI in Node and Go tooling
- ❌ **PyTorch** — nothing in the record

### Nice to have
- ✅ **Public writing** — eight posts

### Gaps worth closing
- A project showing a production model.
- A line about evaluation.

### Keywords for the ATS
Terms that are true and missing: RAG, evals, vector search.

### Projects to lead with
- echoscript — the agent tool loop is the closest thing to this role.
- markov-chain-lab — shows the evaluation habit.
- Bad Slug — this row is dropped.

### Resume
new variant

### Route in
Priya Nair, staff engineer.

### Note on the advert
Posted twice this quarter.`;

check('an optional Role at a glance reads the same before or after the score', () => {
  const body = `**Verdict:** Reasonable — the stack matches.
**Score:** 6/10 — mostly from the must-haves.

### Must-haves
- ✅ **TypeScript** — five years across two roles
- ⚠️ **Kubernetes** — adjacent: Docker on ECS
- ❌ **Rust** — nothing in the record

### Nice-to-haves
- ✅ **Design systems** — one role`;
  const glance = `### Role at a glance
Location: Bengaluru · Mode: on-site | hybrid | remote · Level: Senior · Years: 5+ · Pay: not stated · Posted: 2026-11-02`;
  const expectedFacts = {
    Location: 'Bengaluru',
    Mode: 'on-site | hybrid | remote',
    Level: 'Senior',
    Years: '5+',
    Pay: 'not stated',
    Posted: '2026-11-02',
  };
  for (const [name, text, facts] of [
    ['after the score', `${body}\n\n${glance}`, expectedFacts],
    ['before the score', `${glance}\n\n${body}`, expectedFacts],
    ['absent', body, {}],
  ]) {
    const view = parseFit(text);
    assert.equal(view.recognised, true, `${name}: recognised`);
    assert.deepEqual(view.verdict, { level: 'Reasonable', why: 'the stack matches.' }, `${name}: verdict`);
    assert.deepEqual(view.score, { value: 6, why: 'mostly from the must-haves.' }, `${name}: score`);
    assert.deepEqual(view.must.map(item => item.requirement), ['TypeScript', 'Kubernetes', 'Rust'], `${name}: must`);
    assert.deepEqual(view.nice.map(item => item.requirement), ['Design systems'], `${name}: nice`);
    assert.deepEqual(view.facts, facts, `${name}: facts`);
  }
});

check('a fit in the template shape parses into the comparison', () => {
  const view = parseFit(FIT_TEMPLATE);
  assert.equal(view.recognised, true);
  assert.deepEqual(view.verdict, { level: 'Reasonable', why: 'the stack matches, the domain does not.' });
  assert.deepEqual(view.score, { value: 6, why: 'mostly from the must-haves.' });
  assert.deepEqual(view.must.map(item => item.mark), ['met', 'adjacent', 'missing']);
  assert.deepEqual(view.must[0], { mark: 'met', requirement: 'TypeScript', evidence: 'five years across two roles' });
  assert.deepEqual(view.must[1], { mark: 'adjacent', requirement: 'Kubernetes', evidence: 'adjacent: Docker on ECS' });
  assert.deepEqual(view.must[2], { mark: 'missing', requirement: 'Rust', evidence: 'nothing in the record' });
  assert.deepEqual(view.nice.map(item => item.requirement), ['Design systems']);
  assert.deepEqual(view.gaps, [
    "Add the MCP server to the resume's project list.",
    'Write up the edge-cache work.',
  ]);
  assert.deepEqual(view.keywords, ['edge computing', 'D1', 'Workers']);
  assert.deepEqual(view.projects, []);
  assert.deepEqual(view.extra, [{ title: 'Resume', markdown: 'Backend, fintech.' }]);
});

check('a fit in the real shape keeps every item and every extra section', () => {
  const view = parseFit(FIT_REAL);
  assert.equal(view.recognised, true);
  assert.deepEqual(view.verdict, { level: 'Stretch', why: 'strong systems record, no ML production.' });
  assert.deepEqual(view.score, { value: 5, why: 'must-haves are half met.' });
  assert.equal(view.must.length, 4);
  /* The em dash inside the bold requirement is not the separator. */
  assert.deepEqual(view.must[0], {
    mark: 'met',
    requirement: 'AI-native — orchestrate agents',
    evidence: 'not "uses AI tools", but shipped tool loops and an evaluation harness.',
  });
  assert.equal(view.must[1].mark, 'adjacent');
  assert.equal(view.must[2].mark, 'adjacent', '⚠ without U+FE0F is still adjacent');
  assert.equal(view.must[3].mark, 'missing');
  assert.deepEqual(view.nice.map(item => item.mark), ['met']);
  assert.deepEqual(view.gaps, ['A project showing a production model.', 'A line about evaluation.']);
  assert.deepEqual(view.keywords, ['RAG', 'evals', 'vector search']);
  /* A slug that is not the shape `content-schema.ts` emits is dropped. */
  assert.deepEqual(view.projects, [
    { slug: 'echoscript', line: 'the agent tool loop is the closest thing to this role.' },
    { slug: 'markov-chain-lab', line: 'shows the evaluation habit.' },
  ]);
  assert.deepEqual(view.extra.map(section => section.title), ['Resume', 'Route in', 'Note on the advert']);
  assert.equal(view.extra[0].markdown, 'new variant');
  assert.equal(view.extra[2].markdown, 'Posted twice this quarter.');
});

check('the marks imply a score, independent of the model’s number', () => {
  /* Must weigh three, nice one; met is all, adjacent half, missing none;
     scaled to ten and rounded to a half. */
  assert.equal(scoreFromMarks(parseFit(FIT_TEMPLATE)), 5.5);
  assert.equal(scoreFromMarks(parseFit(FIT_REAL)), 5.5);
  assert.equal(scoreFromMarks(parseFit('no marks here')), null, 'nothing assessed is not zero');
  assert.equal(
    scoreFromMarks(
      parseFit('**Verdict:** Strong\n**Score:** 10/10\n### Must-haves\n- ✅ **A** — evidence'),
    ),
    10,
  );
});

check('an optional Role at a glance becomes facts; its absence is an empty object', () => {
  const withFacts = parseFit(`**Verdict:** Reasonable
**Score:** 6/10

### Role at a glance
Location: Bengaluru · Mode: hybrid · Level: Senior · Years: 5+ · Pay: not stated

### Must-haves
- ✅ **TypeScript** — five years`);
  assert.deepEqual(withFacts.facts, {
    Location: 'Bengaluru',
    Mode: 'hybrid',
    Level: 'Senior',
    Years: '5+',
    Pay: 'not stated',
  });
  assert.deepEqual(parseFit(FIT_TEMPLATE).facts, {}, 'an older assessment still parses');
  /* An unknown key made of plain words is kept as text rather than dropped. */
  const unknown = parseFit('**Verdict:** Poor\n**Score:** 2/10\n### Role at a glance\nTeam: Platform · On call: yes\n### Must-haves\n- ❌ **Rust** — nothing');
  assert.equal(unknown.facts.Team, 'Platform');
  assert.equal(unknown.facts['On call'], 'yes');
});

check('garbage, prose and CRLF are objects rather than throws', () => {
  for (const input of ['', '   ', 'A paragraph about the role, with no structure at all.', null, undefined, 7]) {
    const view = parseFit(input);
    assert.equal(view.recognised, false);
    assert.deepEqual(view.must, []);
    assert.deepEqual(view.verdict, { level: null, why: '' });
  }
  assert.deepEqual(parseFit(FIT_REAL.replace(/\n/g, '\r\n')), parseFit(FIT_REAL));
});

check('a fit arriving one character at a time never throws and never loses an item', () => {
  let seen = 0;
  for (let end = 0; end <= FIT_REAL.length; end += 1) {
    const view = parseFit(FIT_REAL.slice(0, end));
    const count = view.must.length + view.nice.length;
    assert.ok(count >= seen, `item count fell at ${end}: ${seen} → ${count}`);
    seen = count;
  }
  assert.equal(seen, 5);
});

/* ---------- job view: contacts ---------- */

check('a contact line splits into name, title and a link only when http(s)', () => {
  assert.deepEqual(parseContact('Priya Raman — Technical Recruiter — https://www.linkedin.com/in/priya'), {
    name: 'Priya Raman',
    title: 'Technical Recruiter',
    url: 'https://www.linkedin.com/in/priya',
    email: null,
    raw: 'Priya Raman — Technical Recruiter — https://www.linkedin.com/in/priya',
  });
  for (const bad of [
    'Priya Nair — javascript:alert(document.cookie)',
    'Priya Nair — /in/priya',
    'Priya Nair — data:text/html,x',
  ]) {
    const contact = parseContact(bad);
    assert.equal(contact.name, 'Priya Nair');
    assert.equal(contact.url, null, `${bad} is not a link`);
  }
  assert.deepEqual(parseContact('Priya Nair'), { name: 'Priya Nair', title: '', url: null, email: null, raw: 'Priya Nair' });
  assert.equal(parseContact('').name, '');
  /* A title may contain a spaced hyphen, and the link is still the last part. */
  assert.deepEqual(parseContact('Priya Nair — Recruiter - India — https://example.com/priya'), {
    name: 'Priya Nair',
    title: 'Recruiter - India',
    url: 'https://example.com/priya',
    email: null,
    raw: 'Priya Nair — Recruiter - India — https://example.com/priya',
  });
  /* With no em dash at all, the plain hyphen is still the separator. */
  const hyphenated = parseContact('Priya Nair - Engineer - https://example.com/priya');
  assert.deepEqual(
    { name: hyphenated.name, title: hyphenated.title, url: hyphenated.url },
    { name: 'Priya Nair', title: 'Engineer', url: 'https://example.com/priya' },
  );
});

check('an email is its own part, never the title, and the URL need not be last', () => {
  const four = parseContact(
    'Priya Nair — priya@example.com — Technical Recruiter — https://example.com/priya',
  );
  assert.deepEqual(
    { name: four.name, title: four.title, url: four.url, email: four.email },
    {
      name: 'Priya Nair',
      title: 'Technical Recruiter',
      url: 'https://example.com/priya',
      email: 'priya@example.com',
    },
  );
  const middle = parseContact('Priya Nair — https://example.com/priya — Technical Recruiter');
  assert.deepEqual(
    { name: middle.name, title: middle.title, url: middle.url, email: middle.email },
    {
      name: 'Priya Nair',
      title: 'Technical Recruiter',
      url: 'https://example.com/priya',
      email: null,
    },
  );
  const noUrl = parseContact('Priya Nair — priya@example.com — Technical Recruiter');
  assert.deepEqual(
    { name: noUrl.name, title: noUrl.title, url: noUrl.url, email: noUrl.email },
    { name: 'Priya Nair', title: 'Technical Recruiter', url: null, email: 'priya@example.com' },
  );
  /* The address is removed wherever it sat in the line. */
  const trailing = parseContact('Priya Nair — Technical Recruiter — priya@example.com');
  assert.equal(trailing.title, 'Technical Recruiter');
  assert.equal(trailing.email, 'priya@example.com');
});

check('a contact written back reads the same again', () => {
  const contact = { name: 'Priya Raman', title: 'Technical Recruiter', url: 'https://example.com/priya', email: null };
  assert.equal(formatContact(contact), 'Priya Raman — Technical Recruiter — https://example.com/priya');
  const again = parseContact(formatContact(contact));
  assert.deepEqual(
    { name: again.name, title: again.title, url: again.url, email: again.email },
    { name: contact.name, title: contact.title, url: contact.url, email: contact.email },
    'format → parse round-trips',
  );
  /* Without a link the title is still the second part, not a URL. */
  assert.equal(formatContact({ name: 'Priya', title: 'Engineer', url: 'javascript:alert(1)', email: null }), 'Priya — Engineer');
  /* New four-part lines round-trip, and an email without a URL is written as
     the third part. */
  const full = { name: 'Priya Nair', title: 'Recruiter', url: 'https://example.com/priya', email: 'priya@example.com' };
  assert.equal(
    formatContact(full),
    'Priya Nair — Recruiter — https://example.com/priya — priya@example.com',
  );
  assert.deepEqual(parseContact(formatContact(full)), { ...full, raw: formatContact(full) });
  const emailOnly = { name: 'Priya Nair', title: 'Recruiter', url: null, email: 'priya@example.com' };
  assert.equal(formatContact(emailOnly), 'Priya Nair — Recruiter — priya@example.com');
  assert.deepEqual(
    (({ name, title, url, email }) => ({ name, title, url, email }))(parseContact(formatContact(emailOnly))),
    emailOnly,
  );
  /* Old three-part lines still round-trip byte-for-byte. */
  const old = 'Priya Nair — Technical Recruiter — https://example.com/priya';
  assert.equal(formatContact(parseContact(old)), old);
});

/* ---------- job view: outreach ---------- */

check('kept drafts round-trip through the stored markdown', () => {
  const drafts = [
    { contact: 'Priya Nair', channel: 'LinkedIn note', text: 'Hi Priya, I build MCP servers and agent tooling end to end…' },
    { contact: 'Arjun Mehta', channel: 'Referral ask', text: 'Hi Arjun, we overlapped at Initech…' },
  ];
  assert.deepEqual(parseOutreach(formatOutreach(drafts)), drafts);
  assert.deepEqual(parseOutreach(''), []);
  assert.deepEqual(parseOutreach(null), []);
});

check('a sent date is part of a kept draft, and an older heading still parses', () => {
  const sent = [
    { contact: 'Priya Nair', channel: 'LinkedIn note', text: 'Hi Priya…' },
    { contact: 'Priya Nair', channel: 'Email', text: 'Subject: hello\n\nHi Priya…', sent: '2026-11-12' },
  ];
  assert.deepEqual(parseOutreach(formatOutreach(sent)), sent);
  /* Without the optional part, the heading is read exactly as it was. */
  assert.deepEqual(parseOutreach('## Priya Nair · LinkedIn note\nHi'), [
    { contact: 'Priya Nair', channel: 'LinkedIn note', text: 'Hi' },
  ]);
  /* A third part that is not `sent …` is still part of the channel. */
  assert.deepEqual(parseOutreach('## Priya · Email · very long\nHi')[0].channel, 'Email · very long');
});

check('the composer’s ask, tone and line reach the instruction', () => {
  const person = { name: 'Priya Nair', title: 'Recruiter', url: null, raw: 'Priya Nair' };
  const steer = outreachInstruction(person, 'message', undefined, {
    ask: 'referral',
    tone: 'warm',
    note: 'I built the eval harness at Acme.',
  });
  assert.match(steer, /LinkedIn message to Priya, Recruiter/);
  assert.match(steer, /refer me/);
  assert.match(steer, /warmly/);
  assert.match(steer, /eval harness at Acme/);
  /* Nothing supplied is a prompt of its own: every part is a fixed sentence. */
  const plain = outreachInstruction(person, 'note');
  assert.match(plain, /^LinkedIn connection note to Priya, Recruiter$/);
});

check('five working days skips the weekend', () => {
  /* 2026-11-13 is a Friday; five working days later is the following Friday. */
  assert.equal(workingDaysAfter('2026-11-13', 5), '2026-11-20');
  assert.equal(workingDaysAfter('2026-11-09', 1), '2026-11-10');
  assert.equal(workingDaysAfter('not a date', 5), 'not a date');
});

check('nextAction: a sent draft with nothing after it offers the follow-up', () => {
  const evaluated = {
    jobDescription: 'the advert',
    fit: '**Verdict:** Reasonable\n**Score:** 6/10\n### Must-haves\n- ✅ **TypeScript** — five years',
  };
  const next = nextAction(
    {
      ...evaluated,
      status: 'applied',
      appliedOn: '2026-11-01',
      nextOn: '2026-11-09',
      nextStep: 'Follow up with Priya',
      outreach: '## Priya Nair · Email · sent 2026-11-01\nSubject: hi\n\nHi Priya…',
    },
    '2026-11-10',
  );
  assert.match(next.text, /Follow up with Priya/);
  assert.equal(next.button, 'Draft the follow-up');
  assert.equal(next.act, 'followup');
  /* A later draft closes the thread, so the due rule is back. */
  const later = nextAction(
    {
      ...evaluated,
      status: 'applied',
      appliedOn: '2026-11-01',
      nextOn: '2026-11-09',
      nextStep: 'Follow up with Priya',
      outreach:
        '## Priya Nair · Email · sent 2026-11-01\nHi\n\n## Priya Nair · Follow-up\nA second note.',
    },
    '2026-11-10',
  );
  assert.equal(later.act, undefined);
});

check('a draft’s Subject line becomes the mailto subject, not the body', () => {
  assert.deepEqual(splitSubject('Subject: Hello\n\nBody here'), { subject: 'Hello', body: 'Body here' });
  assert.deepEqual(splitSubject('subject: lower case\nBody'), { subject: 'lower case', body: 'Body' });
  assert.deepEqual(splitSubject('\n\nSubject:   Spaced   \n\n\nBody line one\nBody line two'), {
    subject: 'Spaced',
    body: 'Body line one\nBody line two',
  });
  assert.deepEqual(splitSubject('No subject here\nBody'), {
    subject: '',
    body: 'No subject here\nBody',
  });
  assert.deepEqual(splitSubject('Subject: Only'), { subject: 'Only', body: '' });
  assert.deepEqual(splitSubject(''), { subject: '', body: '' });
});

check('a `## ` line inside a draft body starts a draft — the format’s one limit', () => {
  /* Pinned, not accidental: the heading is the only delimiter the column has.
     Drafts are messages, not markdown documents, so this is the trade taken. */
  const tricky = [{ contact: 'Priya', channel: 'Email', text: 'One\n## Two\nThree' }];
  const parsed = parseOutreach(formatOutreach(tricky));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { contact: 'Priya', channel: 'Email', text: 'One' });
  assert.deepEqual(parsed[1], { contact: 'Two', channel: '', text: 'Three' });
});

check('the channel table is closed and its instructions name the person', () => {
  assert.deepEqual(Object.keys(OUTREACH_CHANNELS), ['note', 'message', 'referral', 'email', 'cover', 'followup']);
  assert.equal(OUTREACH_CHANNELS.note.limit, 200);
  assert.equal(OUTREACH_CHANNELS.message.limit, 600);
  assert.equal(OUTREACH_CHANNELS.email.unit, 'words');
  assert.equal(OUTREACH_CHANNELS.cover.limit, 220);

  const priya = { name: 'Priya Raman', title: 'Technical Recruiter', url: null, raw: '' };
  assert.equal(outreachInstruction(priya, 'note'), 'LinkedIn connection note to Priya, Technical Recruiter');
  assert.match(outreachInstruction(priya, 'referral'), /refer me for this role/);
  assert.match(outreachInstruction(priya, 'followup', '2026-11-01'), /applied on 2026-11-01/);
});

check('a draft is measured by the page, at the limit and one over', () => {
  assert.deepEqual(measure('x'.repeat(200), 'note'), {
    count: 200,
    limit: 200,
    unit: 'characters',
    over: false,
  });
  assert.equal(measure('x'.repeat(201), 'note').over, true);
  const words = count => Array.from({ length: count }, () => 'word').join(' ');
  assert.deepEqual(measure(words(150), 'email'), { count: 150, limit: 150, unit: 'words', over: false });
  assert.equal(measure(words(151), 'email').over, true);
  assert.equal(measure('', 'email').count, 0);
});

/* ---------- job view: what to do next ---------- */

const FIT_GOOD = `**Verdict:** Reasonable — ok.
**Score:** 6/10 — fine.

### Must-haves
- ✅ **TypeScript** — yes`;

const FIT_POOR = FIT_GOOD.replace('Reasonable', 'Poor');
const TODAY = '2026-11-10';
const ready = { jobDescription: 'the advert', fit: FIT_GOOD, status: 'saved' };

check('nextAction: no advert comes before everything', () => {
  const next = nextAction({}, TODAY);
  assert.match(next.text, /Paste the advert/);
  assert.equal(next.tab, 'overview');
  assert.equal(next.button, 'Paste the advert');
  assert.equal(next.act, 'details', 'the action is data, not a match on the label');
});

check('nextAction: an advert with no assessment asks for one', () => {
  const next = nextAction({ jobDescription: 'the advert', fit: '' }, TODAY);
  assert.equal(next.act, 'assess');
  assert.equal(next.tab, 'fit');
});

check('nextAction: a Poor verdict on a saved row is information, not a change', () => {
  const next = nextAction({ ...ready, fit: FIT_POOR }, TODAY);
  assert.match(next.text, /scored Poor/);
  assert.equal(next.tab, 'overview');
  assert.equal(next.act, 'notes');
});

check('nextAction: a saved row with no resume variant goes to Resume', () => {
  const next = nextAction(ready, TODAY);
  assert.equal(next.tab, 'resume');
  assert.equal(next.act, undefined);
});

check('nextAction: a contact with no kept draft asks for the referral', () => {
  const next = nextAction(
    { ...ready, resumeVariant: 'backend', contacts: ['Priya Nair — Staff Engineer — https://example.com/priya'] },
    TODAY,
  );
  assert.match(next.text, /Ask before you apply/);
  assert.equal(next.tab, 'outreach');
  assert.equal(next.act, 'draft');
  /* Once a draft is kept, the same row is ready to apply. */
  const kept = nextAction(
    {
      ...ready,
      resumeVariant: 'backend',
      contacts: ['Priya Nair — Staff Engineer'],
      outreach: '## Priya Nair · LinkedIn note\nHi Priya…',
    },
    TODAY,
  );
  assert.equal(kept.act, 'applied');
});

check('nextAction: a saved row with everything else in place is ready to apply', () => {
  const next = nextAction({ ...ready, resumeVariant: 'backend' }, TODAY);
  assert.match(next.text, /Ready to apply/);
  assert.equal(next.act, 'applied');
});

check('nextAction: a due follow-up comes before the one-week rule', () => {
  const next = nextAction(
    { ...ready, status: 'applied', appliedOn: '2026-11-01', nextOn: '2026-11-09', nextStep: 'Follow up with Priya' },
    TODAY,
  );
  assert.equal(next.text, 'Follow-up is due: Follow up with Priya.');
  assert.equal(next.tab, 'outreach');
  assert.equal(next.act, undefined);
});

check('nextAction: a week after applying with nothing scheduled asks for a follow-up', () => {
  const next = nextAction({ ...ready, status: 'applied', appliedOn: '2026-11-01' }, TODAY);
  assert.match(next.text, /A week since you applied/);
  assert.equal(next.tab, 'outreach');
  assert.equal(next.act, undefined);
});

check('nextAction: a closed row is never due a follow-up', () => {
  for (const status of ['rejected', 'withdrawn']) {
    const next = nextAction(
      { ...ready, status, appliedOn: '2026-11-01', nextOn: '2026-11-09', nextStep: 'Follow up with Priya' },
      TODAY,
    );
    assert.deepEqual(next, { text: 'Nothing due.', button: '', tab: 'overview' });
  }
});

check('nextAction: otherwise nothing is due, and there is no button', () => {
  const next = nextAction({ ...ready, status: 'applied', appliedOn: '2026-11-09' }, TODAY);
  assert.equal(next.text, 'Nothing due.');
  assert.equal(next.button, '');
});

/* ---------- job view: searches ---------- */

check('people searches are strings the owner can paste, never a request', () => {
  const searches = peopleSearches('Acme', 'Senior Full-Stack Builder');
  assert.equal(searches.length, 3);
  assert.equal(searches[0], 'Acme technical recruiter');
  assert.equal(searches[1], 'Acme engineering manager Senior Full-Stack');
  assert.equal(searches[2], 'Acme talent acquisition');
});

check('job-view holds no import, so plain Node can load it', () => {
  const source = readFileSync(new URL('../src/lib/job-view.ts', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );
  assert.doesNotMatch(source, /^\s*import\b/m, 'it must stay import-free like job-boards.ts');
});

assert(new BadRequest('x') instanceof Error, 'BadRequest is the shared refusal type');

process.stdout.write(`\ncli: ${checks} checks passed\n`);
