/**
 * A case study's write-up, read as an overview and chapters — decision 81.
 *
 * A case study has two readers. A recruiter gives it a minute; an engineer
 * wants the architecture and the decisions. So when a study is `paged`, its
 * overview carries the facts and a list of chapters, and each `## ` section of
 * the write-up is a page of its own at `/case-studies/<slug>/<heading id>`.
 *
 * ## Split on read, from the HTML
 *
 * There is one stored body and no chapters column. `renderBody()` already
 * gives every heading an id (`<h2 id="core-engineering-decisions">`), so the
 * stored `body_html` is cut at each `<h2 id>` when a page is served — a
 * regex over HTML this repo's own processor wrote, never over anything a
 * visitor sent. Splitting on write would have been a second column to keep in
 * agreement with the first, for a cut that costs microseconds.
 *
 * The heading's id is the chapter's URL. Renaming a heading therefore moves
 * the chapter, and the route answers the old id with a redirect to the
 * overview rather than a 404.
 *
 * ## The facts
 *
 * `metrics` and `links` are stored as lists of strings — one "<value> | <label>"
 * or "<Label> | <url>" per line — so the write boundary needed no new encoder.
 * They are read here. **A link that is not http(s) is dropped**, because it
 * becomes an `href` on this origin: the same rule `job-boards.ts` applies.
 *
 * Imports nothing at runtime, so `npm run check:markdown` loads it in plain
 * Node against `renderBody()`'s real output.
 */

import type { Category } from './content';

export interface Chapter {
  /** The heading's id, which is the chapter's URL segment. */
  id: string;
  /** The heading as text. */
  title: string;
  /** Everything after the heading, up to the next one. */
  html: string;
  /** The chapter's first sentence, for the overview's list and the page description. */
  lead: string;
}

export interface SplitBody {
  /** What comes before the first `## ` — the overview's opening. */
  intro: string;
  /** Empty when the write-up has no `## ` at all. */
  chapters: Chapter[];
}

/**
 * A heading the author wrote, exactly as the processor emits one: at the start
 * of a line, `id` its only attribute, the id made of slug characters only.
 *
 * Every one of those three is load-bearing, and the third most of all. The
 * serialiser escapes `<` in text but **not inside an attribute value**, so a
 * link title can carry the literal text `<h2 id=` — and a looser pattern then
 * takes that attribute's own closing quote as the id's opening one, cuts the
 * body in the middle of a tag, and hands `set:html` a fragment whose first
 * bytes were inert attribute text and are now markup. A slug cannot contain
 * the `>` or space that must follow an attribute's closing quote, so with the
 * id restricted no attribute can ever be mistaken for a heading. `check:markdown`
 * pins it with that exact body.
 */
const H2 = /(?<=^|\n)<h2 id="([\p{L}\p{M}\p{N}_-]+)">([\s\S]*?)<\/h2>/gu;

/**
 * GFM's footnotes: one `<section data-footnotes>` at the end of the body,
 * carrying its own (screen-reader-only) `<h2>`. Lifted off before splitting —
 * it is not a chapter — and given back to each chapter that cites a note, so
 * a reference never points at a list on another page.
 */
const FOOTNOTES = /\n?<section data-footnotes=""[^>]*>[\s\S]*<\/section>\s*$/;

/** Inside a block that may hold a heading but is not a chapter boundary. */
const depthAt = (html: string, at: number) => {
  const before = html.slice(0, at);
  const opened = before.match(/(?<=^|\n)<blockquote>/g)?.length ?? 0;
  const closed = before.match(/(?<=^|\n)<\/blockquote>/g)?.length ?? 0;
  return opened - closed;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Markup to plain text: tags dropped, the entities the processor emits decoded. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first sentence of the first paragraph that has words in it, or its first
 * 180 characters. A chapter that opens on its diagram has a paragraph holding
 * only an image, and that is not a lead.
 */
export function leadOf(html: string): string {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match => textOf(match[1]));
  const text = paragraphs.find(Boolean) ?? textOf(html);
  const sentence = /^.+?[.!?](?=\s|$)/.exec(text);
  if (sentence && sentence[0].length <= 220) return sentence[0];
  return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
}

/** Cut a rendered write-up at each `## ` the author wrote. */
export function splitChapters(html: string): SplitBody {
  const notes = FOOTNOTES.exec(html)?.[0] ?? '';
  const body = notes ? html.slice(0, html.length - notes.length) : html;
  /* A part that cites a note carries the notes with it. */
  const withNotes = (part: string) => (notes && part.includes('data-footnote-ref') ? `${part}${notes}` : part);

  const marks = [...body.matchAll(H2)].filter(mark => depthAt(body, mark.index!) === 0);
  if (!marks.length) return { intro: html, chapters: [] };
  const chapters = marks.map((mark, i) => {
    const start = mark.index! + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : body.length;
    const part = body.slice(start, end);
    return { id: mark[1], title: textOf(mark[2]), html: withNotes(part), lead: leadOf(part) };
  });
  return { intro: withNotes(body.slice(0, marks[0].index)), chapters };
}

/** "a | b" → ['a', 'b']; a line with no separator is all left-hand side. */
const halves = (line: string): [string, string] => {
  const at = line.indexOf(' | ');
  return at < 0 ? [line.trim(), ''] : [line.slice(0, at).trim(), line.slice(at + 3).trim()];
};

export interface Metric { value: string; label: string }
export interface Link { label: string; url: string }

/** The overview's number cards. Four at most: a fifth is a list, not a glance. */
export function metricsOf(lines: string[]): Metric[] {
  return lines
    .map(halves)
    .filter(([value]) => value)
    .slice(0, 4)
    .map(([value, label]) => ({ value, label }));
}

const isWebUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * The overview's extra links. Anything that is not an absolute http(s) URL is
 * dropped — `javascript:`, `data:`, a relative path — because it becomes an
 * `href`. A bare URL with no label is labelled with its host.
 */
export function linksOf(lines: string[]): Link[] {
  return lines.flatMap(line => {
    const [left, right] = halves(line);
    const url = right || left;
    if (!isWebUrl(url)) return [];
    return [{ label: (right && left) || new URL(url).host, url }];
  });
}

/**
 * A starting outline per kind of project — what an engineer expects to read,
 * in the order they expect it. Offered by the editor's Insert outline and
 * handed to the long case-study writer's plan; the work itself decides the
 * final chapters. Typed against `Category`, so a new category fails the
 * typecheck until it has one.
 */
export const CHAPTER_OUTLINES: Record<Category, [heading: string, brief: string][]> = {
  'ml-cv': [
    ['Data and labelling', 'Where the data came from, how it was cleaned and labelled, and what it does not cover.'],
    ['Model', 'The architecture chosen, and the alternatives it beat.'],
    ['Training and evaluation', 'How it was trained, the metrics, and the evaluation set.'],
    ['Inference pipeline', 'How a prediction is served: pre-processing, runtime, latency.'],
    ['Results and limits', 'What it achieves, where it fails, what comes next.'],
  ],
  'ai-llm': [
    ['Architecture', 'The components and how a request flows through them.'],
    ['Retrieval, prompting and the agent loop', 'What the model is given, and how it decides what to do next.'],
    ['Evaluation and guardrails', 'How quality is measured, and what stops a bad answer.'],
    ['Deployment', 'Where it runs, what it costs, and how it is operated.'],
    ['Results and limits', 'What works, what does not yet, and why.'],
  ],
  'full-stack': [
    ['Architecture', 'The pieces, where each runs, and how they talk.'],
    ['Data model', 'The tables or documents, and the constraints that keep them honest.'],
    ['API', 'The endpoints, authentication, and the contract with the client.'],
    ['Frontend', 'The screens, state, and the interactions that took the most work.'],
    ['Deployment and operations', 'Build, hosting, monitoring, and what happens when it breaks.'],
    ['Results', 'What shipped, and what was learned.'],
  ],
  devtools: [
    ['Design', 'The problem in the developer’s day, and the shape of the tool that answers it.'],
    ['Internals', 'How it works underneath.'],
    ['Developer experience', 'Installation, commands, error messages, defaults.'],
    ['Trade-offs', 'What it deliberately does not do.'],
    ['Results', 'Where it is used, and what it changed.'],
  ],
  systems: [
    ['Design', 'The constraints, and the architecture they forced.'],
    ['Internals', 'The data structures, protocols and concurrency model.'],
    ['Performance', 'What was measured, how, and what moved the numbers.'],
    ['Trade-offs', 'What was given up, and why that was the right price.'],
    ['Results', 'What it does now, and its limits.'],
  ],
  simulation: [
    ['The model', 'What is being simulated, and the maths behind it.'],
    ['The engine', 'How the simulation steps, and how it stays stable.'],
    ['Visualisation', 'How a reader sees and steers it.'],
    ['Validation', 'How the results were checked against reality or theory.'],
    ['Results', 'What it shows, and where it stops being accurate.'],
  ],
  other: [
    ['Context', 'Why this was built, and for whom.'],
    ['Approach', 'The idea, and the alternatives considered.'],
    ['Implementation', 'How it was built.'],
    ['Results', 'What it does, and what was learned.'],
  ],
};

/**
 * The outline as markdown to insert: each heading with an italic line saying
 * what to cover. Not an HTML comment — the markdown pass escapes raw HTML, so
 * a comment would be printed on the page.
 */
export function outlineMarkdown(category: Category): string {
  return CHAPTER_OUTLINES[category].map(([heading, brief]) => `## ${heading}\n\n_${brief}_\n`).join('\n');
}

/** The outline as one line, for the long writer's plan: "Design → Internals → …". */
export function outlineLine(category: Category): string {
  return CHAPTER_OUTLINES[category].map(([heading]) => heading).join(' → ');
}
