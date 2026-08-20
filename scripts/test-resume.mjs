#!/usr/bin/env node
/**
 * The resume's three pieces of non-obvious logic, as assertions.
 *
 * `scripts/test-ai.mjs` is the model for this: plain `node:assert`, no
 * framework, importing the `.ts` modules directly and letting Node strip the
 * types (hence Node >= 22.18, which `package.json` already declares). Run by
 * `npm run check:resume`, and by `npm run check` before it.
 *
 * Three things here can be wrong silently, and each one produces a document
 * that is sent to an employer:
 *
 *   1. **`parseLegacyDates`** reads the hand-typed ranges the document had
 *      before the months existed. Getting it wrong does not throw — it puts a
 *      confident, incorrect date on a resume, or silently loses the end of a
 *      job. It has to be *conservative*: anything it cannot read must come back
 *      `null` so the author's own words are shown instead.
 *
 *   2. **`resolveVariant`** is the one composition point — master plus variant
 *      plus the live project rows — and every screen renders what it returns.
 *      Its failure modes are a role that should have been dropped appearing on
 *      a tailored resume, a hidden project being cited, and a variant's
 *      overrides being ignored.
 *
 *   3. **`renderSheet`** goes into `innerHTML` on the admin screen. Every
 *      interpolation is escaped, and this is what says so — the argument for it
 *      is in that module's header and it does not depend on who can write the
 *      row today.
 *
 * What is deliberately *not* here: that the sheet looks right. That is CSS and
 * a printer, and a test asserting a class name is on an element is a test that
 * fails when the design changes and passes when the design is wrong.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* Same resolve hook, same reason — see the note in `test-ai.mjs`. */
register(pathToFileURL(join(here, 'ts-resolve.mjs')));

const load = path => import(pathToFileURL(join(root, path)).href);

const { formatMonth, formatRange, formatDuration, parseLegacyDates } = await load('src/lib/format.ts');
const {
  RESUME_LAYOUTS,
  documentOf,
  entryRange,
  isResumeLayout,
  newVariant,
  normaliseResume,
  resolveVariant,
} = await load('src/lib/resume.ts');
const { renderSheet, esc, resumeContext } = await load('src/lib/resume-render.ts');

let checks = 0;
function check(name, run) {
  try {
    run();
    checks += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (error) {
    process.stdout.write(`  FAIL  ${name}\n    ${error.message}\n`);
    process.exitCode = 1;
  }
}

/* ---------- 1. months ---------- */

check('a month is formatted in its own year, whatever the reader’s timezone', () => {
  /* `new Date('2024-07')` is UTC midnight rendered locally, which is June for
     anyone west of Greenwich. The formatter is built by hand for that reason,
     and this is the assertion that would catch a "simplification" back to
     `toLocaleDateString`. */
  assert.equal(formatMonth('2024-07'), 'Jul 2024');
  assert.equal(formatMonth('2024-01'), 'Jan 2024');
  assert.equal(formatMonth('2024-12'), 'Dec 2024');
});

check('an absent end month is Present, and a broken start is no range at all', () => {
  assert.equal(formatMonth(null), 'Present');
  assert.equal(formatMonth(''), 'Present');
  assert.equal(formatRange('2024-07', null), 'Jul 2024 — Present');
  assert.equal(formatRange('2022-12', '2024-07'), 'Dec 2022 — Jul 2024');
  /* Not "— Present": a row with no start has nothing to say, and saying
     "Present" about it would be inventing a current job. */
  assert.equal(formatRange('', null), '');
  assert.equal(formatRange('nonsense', '2024-01'), '');
  assert.equal(formatMonth('2024-13'), 'Present');
});

check('a duration is inclusive, and a running job is measured to now', () => {
  assert.equal(formatDuration('2024-07', '2026-08'), '2 yr 2 mo');
  assert.equal(formatDuration('2024-01', '2024-01'), '1 mo');
  assert.equal(formatDuration('2023-01', '2023-12'), '1 yr');
  assert.equal(formatDuration('2024-01', '2024-05'), '5 mo');
  assert.equal(formatDuration('', null), '');

  /* The whole reason the months are stored rather than the sentence: a running
     job's duration is a function of the clock, so it can never be stale. */
  const now = new Date();
  const started = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert.equal(formatDuration(started, null), '1 yr 1 mo');
});

/* ---------- 2. reading what was already stored ---------- */

check('the ranges actually in the database are read', () => {
  /* Verbatim from `migrations/0003_documents.sql`. If these three stop parsing,
     the resume silently falls back to showing a stale "(1 year 10 months)". */
  assert.deepEqual(parseLegacyDates('July 2024 - Present (1 year 10 months)'), {
    start: '2024-07',
    end: null,
  });
  assert.deepEqual(parseLegacyDates('June 2023 - September 2024 (1 year 4 months)'), {
    start: '2023-06',
    end: '2024-09',
  });
  assert.deepEqual(parseLegacyDates('December 2022 - July 2024'), {
    start: '2022-12',
    end: '2024-07',
  });
});

check('the separators and spellings people actually type are accepted', () => {
  const july = { start: '2024-07', end: null };
  assert.deepEqual(parseLegacyDates('Jul 2024 – Present'), july);
  assert.deepEqual(parseLegacyDates('Jul. 2024 — Present'), july);
  assert.deepEqual(parseLegacyDates('July 2024 to now'), july);
  assert.deepEqual(parseLegacyDates('July 2024'), july);
  assert.deepEqual(parseLegacyDates('2024-07 - 2025-01'), { start: '2024-07', end: '2025-01' });
  assert.deepEqual(parseLegacyDates('2019 - 2021'), { start: '2019-01', end: '2021-01' });
});

check('an ISO month is not torn apart by the range splitter', () => {
  /* The splitter has to break `A - B` without breaking `2024-07`, which is why
     an ASCII hyphen needs whitespace around it and an en dash does not. A
     regex that split on any hyphen turns one month into two halves of
     nothing. */
  assert.deepEqual(parseLegacyDates('2024-07'), { start: '2024-07', end: null });
  assert.deepEqual(parseLegacyDates('2024-07–2025-01'), { start: '2024-07', end: '2025-01' });
});

check('anything it cannot read comes back null rather than a guess', () => {
  /* This is the property that matters. A wrong date written confidently onto a
     resume is worse than the author's own imperfect string, so every one of
     these has to refuse rather than produce something plausible. */
  for (const input of ['', '   ', 'summer of 2024', 'a while ago', '(2 years)', 'Smarch 2024']) {
    assert.equal(parseLegacyDates(input), null, `parsed "${input}" instead of refusing`);
  }
});

check('a legacy row keeps its own words when the parse refuses', () => {
  const resume = normaliseResume({
    experience: [
      { title: 'Engineer', company: 'Acme', dates: 'July 2024 - Present (1 year 10 months)' },
      { title: 'Advisor', company: 'Other', dates: 'on and off since the pandemic' },
    ],
  });

  /* Parsed: the months become the truth and the stale sentence is dropped. */
  assert.equal(resume.experience[0].start, '2024-07');
  assert.equal(resume.experience[0].end, null);
  assert.equal(resume.experience[0].dates, undefined);

  /* Unparsed: no months, and the string survives as what to show. */
  assert.equal(resume.experience[1].start, '');
  assert.equal(resume.experience[1].dates, 'on and off since the pandemic');
  assert.equal(entryRange(resume.experience[1]), 'on and off since the pandemic');
});

/* ---------- 3. normalising ---------- */

/** The shape the tests below compose against: two roles at the same company. */
const master = () =>
  normaliseResume({
    summary: 'The default statement.',
    experience: [
      {
        title: 'Software Engineer',
        company: 'Axcend Automation',
        start: '2024-07',
        end: null,
        location: 'Bengaluru',
        description: 'Industrial automation.',
        highlights: ['Shipped a copilot.', 'Wrote an orchestration layer.'],
      },
      {
        title: 'Subject Matter Expert',
        company: 'Chegg India',
        start: '2023-06',
        end: '2024-09',
        location: '',
        description: 'Reviewed solutions.',
        highlights: [],
      },
      {
        title: 'Intern',
        company: 'Axcend Automation',
        start: '2024-01',
        end: '2024-05',
        location: 'Bengaluru',
        description: 'Control systems.',
        highlights: [],
      },
    ],
    skills: [
      { category: 'ML / CV', items: ['PyTorch', 'OpenCV', 'YOLO'] },
      { category: 'Web', items: ['Astro', 'React'] },
    ],
    certifications: ['SQL (Intermediate)', 'Data Fundamentals'],
    education: [{ school: 'Pondicherry University', degree: 'MSc Computer Science', start: '2022-12', end: '2024-07' }],
  });

const projects = [
  {
    slug: 'visionid',
    data: { title: 'VisionID', summary: 'Face analysis on a phone camera.', repoUrl: 'https://github.com/x/visionid', hidden: false },
  },
  {
    slug: 'secret-thing',
    data: { title: 'Secret Thing', summary: 'Not for the public.', repoUrl: 'https://github.com/x/secret', hidden: true },
  },
  {
    slug: 'echoscript',
    data: { title: 'EchoScript', summary: 'Transcription pipeline.', repoUrl: 'https://github.com/x/echoscript', demoUrl: 'https://echo.example', hidden: false },
  },
];

check('two roles at the same company get two ids', () => {
  /* The failure this exists for: an id derived from the company alone would
     collide, and every variant referencing "axcend-automation" would select
     both roles or neither. */
  const resume = master();
  const ids = resume.experience.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, `ids collided: ${ids.join(', ')}`);
  assert.ok(ids.every(Boolean), 'a role has no id');
});

check('ids are a pure function of the document, so a stored variant still resolves', () => {
  /* Normalising twice must produce the same ids — otherwise a variant saved in
     one session references roles that do not exist in the next. */
  const first = master().experience.map(entry => entry.id);
  const second = master().experience.map(entry => entry.id);
  assert.deepEqual(first, second);
});

check('an empty document is a complete document', () => {
  const empty = normaliseResume(null);
  assert.deepEqual(empty.experience, []);
  assert.deepEqual(empty.variants, []);
  assert.equal(empty.publicVariant, '');
  assert.equal(empty.summary, '');
  /* Garbage in the column is an empty resume, not a crash on the public page. */
  const junk = normaliseResume({ experience: 'not an array', skills: 7, variants: null });
  assert.deepEqual(junk.experience, []);
  assert.deepEqual(junk.skills, []);
});

check('a public variant that no longer exists is the same as none', () => {
  const resume = normaliseResume({ ...master(), publicVariant: 'deleted-last-week' });
  assert.equal(resume.publicVariant, '');
});

check('every layout the editor offers is one the resolver accepts', () => {
  /* The table drives it rather than a list repeated here: the failure this
     catches is a sheet added to `RESUME_LAYOUTS`, offered in the dropdown, and
     rejected by `isResumeLayout` — which renders as an unstyled document with
     no error anywhere. */
  for (const layout of RESUME_LAYOUTS) assert.ok(isResumeLayout(layout.id), layout.id);
  assert.ok(!isResumeLayout('two-column'));
  assert.ok(!isResumeLayout(undefined));
  /* A stored layout nobody recognises falls back rather than rendering an
     unstyled sheet. */
  const resume = normaliseResume({ variants: [{ id: 'x', label: 'X', layout: 'freeform' }] });
  assert.equal(resume.variants[0].layout, 'ats');
});

/* ---------- 4. resolving one variant ---------- */

const withPerson = doc => ({
  ...doc,
  person: {
    name: 'A Person',
    role: 'Engineer',
    location: 'Bengaluru',
    address: 'Somewhere',
    email: 'a@example.com',
    phone: '1234',
    linkedin: 'https://www.linkedin.com/in/a',
    github: 'https://github.com/a',
    summary: doc.summary,
  },
});

check('the master has a sheet of its own', () => {
  /* It did not, and `resolveVariant` filled the gap with a hard-coded
     `'sidebar'` — so the Sheet picker was inert on the one resume that exists
     before anybody makes a variant. Three things have to hold together for the
     control to work, and each of them is one line: the field survives a
     normalise, it survives `documentOf` on the way back to the row, and the
     resolver reads it. */
  const stored = normaliseResume({ layout: 'timeline' });
  assert.equal(stored.layout, 'timeline');
  assert.equal(documentOf(withPerson(stored)).layout, 'timeline');
  assert.equal(resolveVariant(withPerson(stored), '', []).layout, 'timeline');

  /* A document written before the field existed keeps rendering as the sheet
     it was rendering as, which is the value the resolver used to hard-code. */
  assert.equal(normaliseResume({}).layout, 'sidebar');
  assert.equal(normaliseResume({ layout: 'freeform' }).layout, 'sidebar');

  /* And a variant still wins, because that is what a variant is for. */
  const withVariant = normaliseResume({
    layout: 'timeline',
    variants: [{ id: 'v', label: 'V', layout: 'ats' }],
  });
  assert.equal(resolveVariant(withPerson(withVariant), 'v', []).layout, 'ats');
});

check('no variant resolves to the whole master', () => {
  const resume = withPerson(master());
  const sheet = resolveVariant(resume, '', projects);
  assert.equal(sheet.experience.length, 3);
  assert.equal(sheet.skills.length, 2);
  assert.equal(sheet.summary, 'The default statement.');
  assert.equal(sheet.variantId, '');
  /* Projects are a variant's choice; the master has never made one. */
  assert.deepEqual(sheet.projects, []);
});

check('a variant selects, reorders and rewords without touching the master', () => {
  const doc = master();
  const [first, , third] = doc.experience.map(entry => entry.id);
  doc.variants = [
    {
      id: 'ml',
      label: 'ML / CV Engineer',
      summary: 'Tailored for the role.',
      layout: 'ats',
      /* Deliberately not document order: the variant's order is what renders. */
      experience: [{ id: third }, { id: first, description: 'Reworded for this application.' }],
      skills: [{ category: 'ML / CV', items: ['PyTorch'] }],
      education: [],
      certifications: ['Data Fundamentals'],
      projects: [{ slug: 'visionid', line: 'Framed for an ML role.' }, { slug: 'echoscript' }],
    },
  ];
  const resume = withPerson(normaliseResume(doc));
  const sheet = resolveVariant(resume, 'ml', projects);

  assert.equal(sheet.experience.length, 2);
  assert.equal(sheet.experience[0].title, 'Intern', 'the variant’s order was not used');
  assert.equal(sheet.experience[1].description, 'Reworded for this application.');
  /* The override is per variant. The master's own words are untouched. */
  assert.equal(resume.experience[0].description, 'Industrial automation.');
  /* An override the variant did not make falls through to the master's. */
  assert.deepEqual(sheet.experience[1].highlights, ['Shipped a copilot.', 'Wrote an orchestration layer.']);

  assert.deepEqual(sheet.skills, [{ category: 'ML / CV', items: ['PyTorch'] }]);
  assert.deepEqual(sheet.certifications, ['Data Fundamentals']);
  assert.deepEqual(sheet.education, []);
  assert.equal(sheet.summary, 'Tailored for the role.');
  assert.equal(sheet.person.summary, 'Tailored for the role.');
  assert.equal(sheet.layout, 'ats');

  /* A project's line defaults to the project's own summary, and the URL is the
     demo where there is one and the repository otherwise. */
  assert.equal(sheet.projects[0].line, 'Framed for an ML role.');
  assert.equal(sheet.projects[1].line, 'Transcription pipeline.');
  assert.equal(sheet.projects[1].url, 'https://echo.example');
  assert.equal(sheet.projects[0].url, 'https://github.com/x/visionid');
});

check('a hidden project cannot be cited, however the variant names it', () => {
  /* The same argument `ai-corpus.ts` makes about its own filters: the caller
     having filtered is a convention, filtering here is a function with a test.
     A resume is published at a public URL. */
  const doc = master();
  doc.variants = [
    {
      id: 'v',
      label: 'V',
      layout: 'ats',
      experience: [],
      skills: [],
      education: [],
      certifications: [],
      projects: [{ slug: 'secret-thing', line: 'Should never render.' }, { slug: 'visionid' }],
    },
  ];
  const sheet = resolveVariant(withPerson(normaliseResume(doc)), 'v', projects);
  assert.deepEqual(sheet.projects.map(entry => entry.slug), ['visionid']);
  assert.ok(!JSON.stringify(sheet).includes('Should never render.'));
});

check('a dangling reference is dropped rather than rendering an empty row', () => {
  const doc = master();
  doc.variants = [
    {
      id: 'v',
      label: 'V',
      layout: 'ats',
      experience: [{ id: 'a-role-deleted-last-month' }, { id: doc.experience[0].id }],
      skills: [{ category: 'A group that was renamed' }],
      education: ['gone'],
      certifications: ['never held'],
      projects: [{ slug: 'never-existed' }],
    },
  ];
  const sheet = resolveVariant(withPerson(normaliseResume(doc)), 'v', projects);
  assert.equal(sheet.experience.length, 1);
  assert.deepEqual(sheet.skills, []);
  assert.deepEqual(sheet.education, []);
  assert.deepEqual(sheet.projects, []);
  /* Certifications are their own ids, so a stale one is simply not in the
     master any more — it is filtered by the editor, not by the resolver, and
     what the resolver does with it is show it. That asymmetry is deliberate
     and this asserts it rather than leaving it to be discovered. */
  assert.deepEqual(sheet.certifications, ['never held']);
});

check('an empty variant summary falls back to the master’s', () => {
  const doc = master();
  doc.variants = [
    { id: 'v', label: 'V', summary: '   ', layout: 'ats', experience: [], skills: [], education: [], certifications: [], projects: [] },
  ];
  const sheet = resolveVariant(withPerson(normaliseResume(doc)), 'v', projects);
  assert.equal(sheet.summary, 'The default statement.');
});

check('a new variant starts from everything the master has', () => {
  /* Starting from nothing is the wrong default: removing three roles is one
     gesture each, and finding six of twenty is a form nobody finishes. */
  const doc = master();
  const variant = newVariant(doc, 'Backend');
  assert.equal(variant.experience.length, doc.experience.length);
  assert.equal(variant.skills.length, doc.skills.length);
  assert.deepEqual(variant.certifications, doc.certifications);
  assert.deepEqual(variant.projects, [], 'projects are a deliberate choice, not a default');
  assert.equal(variant.id, 'backend');
});

/* ---------- 5. the renderer ---------- */

check('every interpolation is escaped', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"quoted"'), '&quot;quoted&quot;');
  assert.equal(esc("it's"), 'it&#39;s');
  /* `&` first, or the entities the other replacements produce get re-escaped. */
  assert.equal(esc('&lt;'), '&amp;lt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

check('markup in the content cannot become markup in the sheet', () => {
  /* This goes into `innerHTML` on the admin screen. The row is owner-written
     today; the escaping is what makes that not the load-bearing part. */
  const doc = master();
  doc.summary = '<img src=x onerror="alert(1)">';
  doc.experience[0].title = '</h3><script>alert(2)</script>';
  doc.experience[0].highlights = ['Shipped <b>this</b> & that'];
  const html = renderSheet(resolveVariant(withPerson(normaliseResume(doc)), '', projects));

  /* Checked as *tags*, not as substrings. `onerror=` still appears in the
     output — as the text `onerror=&quot;alert(1)&quot;` inside a paragraph,
     which is inert and is exactly what escaping is supposed to produce. What
     must not appear is an element the content opened. */
  assert.ok(!/<script/i.test(html), 'a script tag survived into the sheet');
  assert.ok(!/<img/i.test(html), 'an img tag survived into the sheet');
  assert.ok(!/<\/h3>\s*<script/i.test(html), 'the content closed a tag the renderer opened');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;/h3&gt;'));
  assert.ok(html.includes('onerror=&quot;alert(1)&quot;'), 'the payload should survive as text');
  assert.ok(html.includes('Shipped &lt;b&gt;this&lt;/b&gt; &amp; that'));
});

check('the layout is an attribute, not a second set of markup', () => {
  /* Every layout emits the same sections in the same order; only `data-layout`
     differs, which is what stops a field being added to one sheet and
     forgotten on the others. Driven off the table, so a fourth sheet is held to
     the same rule without this test being edited — and the moment somebody
     branches in `renderSheet()`, this is what says so. */
  const doc = master();
  const base = { experience: [], skills: [], education: [], certifications: [], projects: [] };
  doc.variants = RESUME_LAYOUTS.map(layout => ({
    ...base,
    id: layout.id,
    label: 'V',
    layout: layout.id,
  }));
  const resume = withPerson(normaliseResume(doc));

  const rendered = RESUME_LAYOUTS.map(layout => {
    const html = renderSheet(resolveVariant(resume, layout.id, projects));
    assert.ok(html.includes(`data-layout="${layout.id}"`), `${layout.id} did not reach the root`);
    return html.replace(`data-layout="${layout.id}"`, 'X');
  });

  for (const html of rendered.slice(1)) assert.equal(html, rendered[0]);
});

check('the masthead’s job line is not an entry in the history', () => {
  /* They shared `rs-role` for a while, so the two rules meant for a one-line
     tagline — 0.95em and muted — were landing on every job on the sheet, and
     `timeline` then hung a spine and a node off the tagline too. Nothing about
     the collision was visible until a layout gave the class a border, which is
     the argument for pinning it rather than for remembering it. */
  const doc = master();
  const resume = withPerson(normaliseResume(doc));
  const html = renderSheet(resolveVariant(resume, '', projects));

  const head = html.slice(0, html.indexOf('rs-body'));
  assert.ok(head.includes('class="rs-headline"'), 'the masthead lost its own class');
  assert.ok(!head.includes('class="rs-role"'), 'the masthead is styled as a job again');
  /* And the entries still are entries. */
  assert.ok(html.slice(html.indexOf('rs-body')).includes('class="rs-role"'));
});

check('a section with nothing in it is not rendered at all', () => {
  /* An empty "Selected projects" heading with a rule under it is worse than no
     section: on a printed sheet it reads as content that failed to load. */
  const html = renderSheet(resolveVariant(withPerson(normaliseResume({})), '', []));
  assert.ok(!html.includes('Selected projects'));
  assert.ok(!html.includes('Certifications'));
  assert.ok(!html.includes('>Summary<'));
  /* The masthead is unconditional — a resume with no history is still a
     resume with a name on it. */
  assert.ok(html.includes('A Person'));
});

check('the sheet carries no address, because a public page renders it', () => {
  /* `/resume` is a public URL. Email and phone are on a resume on purpose;
     a street address is not, and `site.ts` holds one. */
  const doc = master();
  const sheet = resolveVariant(withPerson(doc), '', projects);
  const html = renderSheet(sheet);
  assert.ok(!html.includes('Somewhere'), 'the street address reached the sheet');
  assert.ok(html.includes('a@example.com'), 'the email should be on a resume');
});

/* ---------- 6. what the assistant is told ---------- */

check('the assistant is given the ids it is asked to return', () => {
  /* `resumeVariant` answers with role ids and skill group names. It can only do
     that if it was told what they are, and the editor drops anything that is
     not in these lists — so an id missing here is a task that silently selects
     nothing. */
  const doc = master();
  const sheet = resolveVariant(withPerson(doc), '', projects);
  const text = resumeContext(sheet, {
    experience: doc.experience.map(entry => ({
      id: entry.id,
      title: entry.title,
      company: entry.company,
      range: entryRange(entry),
    })),
    skills: doc.skills,
    education: doc.education.map(entry => ({ id: entry.id, degree: entry.degree, school: entry.school })),
    certifications: doc.certifications,
  });

  for (const entry of doc.experience) {
    assert.ok(text.includes(entry.id), `role id ${entry.id} is not in the context`);
  }
  for (const group of doc.skills) {
    assert.ok(text.includes(group.category), `skill group ${group.category} is not in the context`);
  }
  for (const item of doc.certifications) assert.ok(text.includes(item));
  assert.ok(text.includes('Selectable items'), 'the inventory half is missing');
  assert.ok(text.includes('The resume as it currently reads'), 'the sheet half is missing');
});

check('the assistant’s view of the resume carries no contact details', () => {
  /* Same rule as `ai-corpus.ts`: the model is told about the work, never about
     how to reach the person. A tailored summary does not need a phone number,
     and a prompt that carries one is a prompt that can be made to repeat it. */
  const doc = master();
  const sheet = resolveVariant(withPerson(doc), '', projects);
  const text = resumeContext(sheet, {
    experience: [],
    skills: [],
    education: [],
    certifications: [],
  });
  for (const secret of ['a@example.com', '1234', 'Somewhere', 'linkedin.com/in/a']) {
    assert.ok(!text.includes(secret), `${secret} reached the assistant's context`);
  }
});

process.stdout.write(`\nresume: ${checks} checks passed\n`);
