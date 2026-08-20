/**
 * One resume, one renderer, three places it appears.
 *
 * The public page renders it on the server, the admin preview renders it in the
 * browser on every keystroke, and the print sheet is the same DOM with a
 * different stylesheet. Before this module there were two implementations: an
 * `.astro` component for the page and a hand-built approximation in the editor
 * — same content, different markup, different classes — and the second was
 * permanently a little bit wrong. "The preview does not look like the live
 * page" was not a bug to fix; it was the arrangement.
 *
 * So it returns an HTML **string** rather than being a component. That is the
 * one shape both callers can use: Astro takes it through `set:html`, the editor
 * assigns it to `innerHTML`, and neither has a second copy of the markup. A
 * component cannot re-render in the browser without a framework, and adding one
 * to draw a resume is a larger dependency than this whole feature.
 *
 * ## Everything interpolated is escaped
 *
 * The content is the owner's own and reaches this through an endpoint only the
 * owner can write to — but it lands in `innerHTML`, and "the only person who
 * can put a `<script>` here is the person whose site it is" is an argument that
 * stops being true the moment anything else can write the row. `esc()` is
 * applied at every interpolation, without exception, and `check:resume` asserts
 * it. There is deliberately no "trusted HTML" escape hatch: nothing in a resume
 * is markup.
 *
 * ## Three layouts, one function
 *
 * `ats` is a single column with plain headings and no positioned elements,
 * because an applicant tracking system reads the PDF as a stream of text and a
 * two-column sheet interleaves the columns. `sidebar` is the designed one, for
 * applications sent to a person. `timeline` is the sheet this site had before
 * this module existed — rail on the left, roles on a dated spine — and it is
 * the one that looks like the rest of the portfolio.
 *
 * They differ by **one attribute on the root** and nothing else. No branch in
 * here builds different markup for them, which is what makes adding a field a
 * change in one place rather than three; `check:resume` renders every entry in
 * `RESUME_LAYOUTS` and asserts the strings are identical apart from that
 * attribute, so the moment somebody adds a branch, that is what says so.
 */

import type { ResumeSheet, SheetProject, SheetRole } from './resume';

/**
 * The five characters that can change the meaning of markup.
 *
 * `&` first — it is the escape character, so escaping it after the others would
 * double-escape what they produced.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `https://www.linkedin.com/in/x` → `linkedin.com/in/x`. */
const bare = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

/** A section, or nothing at all when it has no rows. */
function section(title: string, body: string): string {
  if (!body.trim()) return '';
  return `<section class="rs-section"><h2 class="rs-h">${esc(title)}</h2>${body}</section>`;
}

function contact(sheet: ResumeSheet): string {
  const { person } = sheet;
  /* `mailto:` and `tel:` are the two links worth having on a printed sheet —
     a PDF keeps them live, and a recruiter clicking the address is one fewer
     retyped email. The rest are printed as text with the scheme stripped,
     because a full URL in a contact block is noise a human has to read past. */
  const rows = [
    person.location && `<span>${esc(person.location)}</span>`,
    person.email && `<a href="mailto:${esc(person.email)}">${esc(person.email)}</a>`,
    person.phone && `<a href="tel:${esc(person.phone.replace(/\s/g, ''))}">${esc(person.phone)}</a>`,
    person.linkedin && `<a href="${esc(person.linkedin)}">${esc(bare(person.linkedin))}</a>`,
    person.github && `<a href="${esc(person.github)}">${esc(bare(person.github))}</a>`,
  ].filter(Boolean);

  return `<div class="rs-contact">${rows.join('<span class="rs-dot" aria-hidden="true">·</span>')}</div>`;
}

function role(entry: SheetRole): string {
  const when = [entry.range, entry.duration].filter(Boolean).join(' · ');
  return `<article class="rs-role">
    <div class="rs-role-head">
      <h3 class="rs-role-title">${esc(entry.title)}</h3>
      ${when ? `<span class="rs-when">${esc(when)}</span>` : ''}
    </div>
    <p class="rs-role-org">${esc(entry.company)}${
      entry.location ? `<span class="rs-role-where"> · ${esc(entry.location)}</span>` : ''
    }</p>
    ${entry.description ? `<p class="rs-role-body">${esc(entry.description)}</p>` : ''}
    ${
      entry.highlights.length
        ? `<ul class="rs-points">${entry.highlights
            .map(point => `<li>${esc(point)}</li>`)
            .join('')}</ul>`
        : ''
    }
  </article>`;
}

function project(entry: SheetProject): string {
  /* The URL is printed rather than linked-over-the-title, because a printed
     sheet loses a link and a URL a reader can type is the point of listing a
     side project at all. */
  return `<article class="rs-project">
    <p class="rs-project-head">
      <span class="rs-project-name">${esc(entry.title)}</span>
      ${entry.url ? `<a class="rs-project-url" href="${esc(entry.url)}">${esc(bare(entry.url))}</a>` : ''}
    </p>
    <p class="rs-project-line">${esc(entry.line)}</p>
  </article>`;
}

const skills = (sheet: ResumeSheet): string =>
  sheet.skills.length
    ? `<dl class="rs-skills">${sheet.skills
        .map(
          group =>
            `<div class="rs-skill-row"><dt>${esc(group.category)}</dt><dd>${group.items
              .map(esc)
              .join(' · ')}</dd></div>`,
        )
        .join('')}</dl>`
    : '';

const education = (sheet: ResumeSheet): string =>
  sheet.education.length
    ? `<div class="rs-edu-list">${sheet.education
        .map(
          entry => `<article class="rs-edu">
            <div class="rs-role-head">
              <h3 class="rs-role-title">${esc(entry.degree)}</h3>
              ${entry.range ? `<span class="rs-when">${esc(entry.range)}</span>` : ''}
            </div>
            <p class="rs-role-org">${esc(entry.school)}</p>
          </article>`,
        )
        .join('')}</div>`
    : '';

const certifications = (sheet: ResumeSheet): string =>
  sheet.certifications.length
    ? `<ul class="rs-certs">${sheet.certifications.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';

/**
 * The sheet, as HTML.
 *
 * The root carries `data-layout`, which is the only thing `resume.css` needs to
 * tell the layouts apart — no branch here builds different markup for them, and
 * that is the property worth keeping. A section absent from one layout would be
 * a section to remember when adding a field.
 *
 * The masthead's job line is `rs-headline`, not `rs-role`. `rs-role` is an
 * *entry* in the Experience section, and for a while it was both: the two rules
 * meant for the one-line tagline — 0.95em, muted — were landing on every job on
 * the sheet, and the `timeline` layout then hung a spine and a node off the
 * tagline as well. One class, two things, and the second one only became
 * visible when a layout gave the class a border.
 */
export function renderSheet(sheet: ResumeSheet): string {
  const { person } = sheet;

  const head = `<header class="rs-head">
    <h1 class="rs-name">${esc(person.name)}</h1>
    <p class="rs-headline">${esc(person.role)}</p>
    ${contact(sheet)}
  </header>`;

  const summary = sheet.summary ? section('Summary', `<p class="rs-summary">${esc(sheet.summary)}</p>`) : '';
  const experience = section(
    'Experience',
    sheet.experience.map(role).join(''),
  );
  const projects = section('Selected projects', sheet.projects.map(project).join(''));

  /* The rail in `sidebar`, and three more sections in `ats`. Same strings
     either way — the layout decides where the container is placed, not what
     goes in it. */
  const aside = [
    section('Skills', skills(sheet)),
    section('Education', education(sheet)),
    section('Certifications', certifications(sheet)),
  ].join('');

  const main = [summary, experience, projects].join('');

  return `<div class="rs" data-layout="${esc(sheet.layout)}">
    ${head}
    <div class="rs-body">
      <div class="rs-main">${main}</div>
      <div class="rs-aside">${aside}</div>
    </div>
  </div>`;
}

/* ---------- the same resume, as text a model reads ---------- */

/**
 * What the assistant's `resume` context field carries.
 *
 * Two halves, and the second is the one that makes the tasks *applicable*:
 *
 *   1. **The sheet as it currently reads** — the roles, their bullets, the
 *      skills, the projects already on it. This is what "tailor the summary"
 *      needs, and what stops a summary claiming something the sheet does not
 *      support.
 *   2. **An inventory with ids.** `resumeVariant` returns a list of role ids and
 *      skill group names rather than prose, because it is choosing from what
 *      exists rather than writing a history — and it can only do that if it was
 *      told what the identifiers are. The editor validates every one it gets
 *      back against the same lists, so an invented id costs the model a slot and
 *      nothing else.
 *
 * Plain text with headings, not JSON, for the reason `ai-corpus.ts` gives: a
 * model reads a heading and a list more reliably than a nested object, and the
 * delimiters cost fewer tokens. It is capped by `CONTEXT_LIMITS.resume` on the
 * way out like every other field.
 */
export function resumeContext(
  sheet: ResumeSheet,
  inventory: {
    experience: { id: string; title: string; company: string; range: string }[];
    skills: { category: string; items: string[] }[];
    education: { id: string; degree: string; school: string }[];
    certifications: string[];
  },
): string {
  const lines: string[] = ['# The resume as it currently reads', ''];

  if (sheet.summary) lines.push('## Summary', sheet.summary, '');

  if (sheet.experience.length) {
    lines.push('## Experience');
    for (const role of sheet.experience) {
      lines.push(`- ${role.title}, ${role.company}${role.range ? ` — ${role.range}` : ''}`);
      if (role.description) lines.push(`  ${role.description}`);
      for (const point of role.highlights) lines.push(`  - ${point}`);
    }
    lines.push('');
  }

  if (sheet.skills.length) {
    lines.push('## Skills');
    for (const group of sheet.skills) lines.push(`- ${group.category}: ${group.items.join(', ')}`);
    lines.push('');
  }

  if (sheet.projects.length) {
    lines.push('## Projects already on this variant');
    for (const item of sheet.projects) lines.push(`- ${item.slug} — ${item.line}`);
    lines.push('');
  }

  /* — the inventory. Everything selectable, with the identifier to return. — */
  lines.push('# Selectable items — use these identifiers exactly', '');

  if (inventory.experience.length) {
    lines.push('## Role ids');
    for (const role of inventory.experience) {
      lines.push(`- ${role.id} — ${role.title}, ${role.company}${role.range ? ` (${role.range})` : ''}`);
    }
    lines.push('');
  }

  if (inventory.skills.length) {
    lines.push('## Skill group names');
    for (const group of inventory.skills) {
      lines.push(`- ${group.category}: ${group.items.join(', ')}`);
    }
    lines.push('');
  }

  if (inventory.education.length) {
    lines.push('## Education ids');
    for (const entry of inventory.education) {
      lines.push(`- ${entry.id} — ${entry.degree}, ${entry.school}`);
    }
    lines.push('');
  }

  if (inventory.certifications.length) {
    lines.push('## Certification names');
    for (const item of inventory.certifications) lines.push(`- ${item}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}
