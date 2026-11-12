/**
 * What one answer has to satisfy before it is offered to the owner.
 *
 * One import-free module, for the same reason `journal-auto.ts` and
 * `job-view.ts` are import-free: `scripts/test-ai.mjs` loads it in plain Node
 * and the browser bundles it, so it can hold no I/O, no DOM and no second
 * dependency. Everything a validator needs arrives in `ValidateContext`, which
 * is data the caller already holds — the task's field names, the slugs in the
 * index it was given, the channel's limit, the advert.
 *
 * The same shapes the editor parses live in two other files (`parseFields` in
 * `assist-tasks.ts`, `parseFit` in `job-view.ts`). Nothing here imports either:
 * the recognisers below are deliberately smaller, because a validator only has
 * to answer "is this the shape" and "which required field is empty", not
 * "what exactly did it say". `scoreFromMarks` is the one exception and it is
 * *not* reimplemented here — the caller computes the expected score from the
 * answer it is validating and passes it in, so there is one formula.
 *
 * ## Findings are not errors
 *
 * A repairable finding buys the run exactly one more round (A2 in the plan).
 * A finding marked not repairable — a truncated answer, or a score that
 * disagrees with the marks — is reported to the owner and changes nothing,
 * because asking the same model the same question again will produce the same
 * answer and spend the same money.
 *
 * ## The table is closed
 *
 * `VALIDATORS` and `ValidatorName` are a closed pair, and a task names its
 * validators in `ASSIST_TASKS[...].validators`. A typo is an `astro check`
 * failure rather than a rule that silently never runs, the same arrangement as
 * `AssistField` and `CONTEXT_LIMITS`.
 */

export type ValidatorName =
  | 'shape'
  | 'flowShape'
  | 'slugsExist'
  | 'mermaidLint'
  | 'fitShape'
  | 'fitScore'
  | 'channelLimit'
  | 'banned'
  | 'hasFigure'
  | 'truncated';

export interface Finding {
  /** Stable, machine-readable, and what the panel's one line names. */
  code: ValidatorName;
  /** One sentence the reader can act on. */
  message: string;
  /** Whether one more round could fix it. */
  repairable: boolean;
}

/** The field a `document` task promised, as the validator reads it back. */
export interface ShapeSpec {
  /** Every label the task may write, in contract order. */
  labels: readonly string[];
  /** Labels that must carry a value. Absent means "none in particular". */
  required?: readonly string[];
  /** The label that takes the rest of the answer, if the task has one. */
  tail?: string;
}

export interface ChannelSpec {
  label?: string;
  limit: number;
  unit: 'characters' | 'words';
  /** How many versions the task must return. Absent means "do not check". */
  expect?: number;
  /** Whether each version needs a `Subject:` line. */
  subject?: boolean;
}

/**
 * Everything a validator may read. Nothing is fetched and nothing is inferred
 * from a clock: a caller that has the value passes it, and a validator with no
 * value for its rule stands down rather than guessing.
 */
export interface ValidateContext {
  shape?: ShapeSpec;
  /** Every slug the run was shown. A cited slug outside this list is invented. */
  slugs?: readonly string[];
  channel?: ChannelSpec;
  /** Phrases this task's own instructions forbid. `!` is always forbidden. */
  banned?: readonly string[];
  /** The vendor's `finish_reason`, when the caller knows it. */
  stopReason?: string;
  /**
   * What `scoreFromMarks()` makes of this answer, already computed by the
   * caller. Undefined means the comparison is not available; the validator
   * then does nothing rather than repeating the formula.
   */
  expectedScore?: number | null;
  /** A prose section over this many words needs a figure or a list. */
  figureWords?: number;
}

export type Validator = (answer: string, ctx: ValidateContext) => Finding[];

const finding = (
  code: ValidatorName,
  message: string,
  repairable = true,
): Finding => ({ code, message, repairable });

/* ---------- reading a labelled answer, minimally ---------- */

const cleanLabel = (value: string): string =>
  value
    .replace(/^[*_#\s]+/, '')
    .replace(/[*_\s]+$/, '')
    .trim()
    .toUpperCase();

/** `**TITLE:** x`, `TITLE: x`, `## TITLE`, `**TITLE**` — the four forms. */
function labelOf(line: string): string | null {
  const colon = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*([A-Za-z][A-Za-z ]{1,24}?)\s*(?:\*\*|__)?\s*:\s*(.*)$/.exec(
    line,
  );
  if (colon) return cleanLabel(colon[1]);
  const alone = /^\s*#{0,6}\s*(?:\*\*|__)?\s*([A-Za-z][A-Za-z ]{1,24}?)\s*(?:\*\*|__)?\s*:?\s*$/.exec(
    line,
  );
  return alone ? cleanLabel(alone[1]) : null;
}

/**
 * Which declared labels carry a value.
 *
 * Not `parseFields`: this only needs to know that a label was seen and that a
 * required one is not empty. It follows the same forgiving reading — a wrapped
 * fence, bold labels, a label alone on a line with its content below it — so a
 * response the editor accepts is not rejected here.
 */
function readLabels(text: string, spec: ShapeSpec): { seen: boolean; filled: Set<string> } {
  const known = new Map<string, string>();
  for (const label of spec.labels) known.set(cleanLabel(label), cleanLabel(label));
  const tail = spec.tail ? cleanLabel(spec.tail) : '';

  let source = text.replace(/^\s*```[a-z]*\s*\n?/i, '');
  if (/^\s*```/.test(text)) source = source.replace(/\n?```\s*$/, '');

  const filled = new Set<string>();
  let seen = false;
  let tailStarted = false;
  let block: string | null = null;
  let tailValue = '';

  for (const line of source.split('\n')) {
    if (tailStarted) {
      tailValue += `${line}\n`;
      continue;
    }
    const label = labelOf(line);
    const key = label ? known.get(label) : undefined;
    if (!key) {
      if (block) {
        const text = line.trim();
        if (text && !/^([-*_])\1{2,}$/.test(text)) filled.add(block);
      }
      continue;
    }

    seen = true;
    if (key === tail) {
      tailStarted = true;
      block = null;
      const trailing = line.replace(/^.*?:\s*/, '').trim();
      if (trailing) tailValue += `${trailing}\n`;
      continue;
    }

    const value = line.replace(/^.*?:\s*/, '').replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '').trim();
    if (value) {
      filled.add(key);
      block = null;
    } else {
      block = key;
    }
  }
  if (tailStarted && tailValue.trim()) filled.add(tail);
  return { seen, filled };
}

/* ---------- shape ---------- */

const shape: Validator = (answer, ctx) => {
  if (!ctx.shape) return [];
  const { seen, filled } = readLabels(answer, ctx.shape);
  if (!seen) {
    return [
      finding(
        'shape',
        `The answer used none of the labels this task asks for (${ctx.shape.labels.slice(0, 4).join(', ')}).`,
      ),
    ];
  }
  const out: Finding[] = [];
  for (const required of ctx.shape.required ?? []) {
    if (!filled.has(cleanLabel(required))) {
      out.push(finding('shape', `${required} was left empty.`));
    }
  }
  return out;
};

/* ---------- the project's flow ---------- */

/**
 * Three to seven `Step name | what happens here` lines after a `FLOW:` label.
 *
 * The shape is the whole meaning here, so the checks are the shape: a step
 * without a separator is a paragraph, a side that is empty is a step nobody can
 * read, and eight steps is not a glance. Decision 85.
 */
const flowShape: Validator = answer => {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n');
  let found = false;
  let rest = '';
  for (const line of lines) {
    if (!found) {
      const label = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*FLOW\s*(?:\*\*|__)?\s*:?\s*(.*)$/i.exec(line);
      if (label) {
        found = true;
        rest = label[1];
      }
      continue;
    }
    rest += `\n${line}`;
  }
  if (!found) return [finding('flowShape', 'There is no FLOW: section.')];

  const steps = rest
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  const out: Finding[] = [];
  if (steps.length < 3 || steps.length > 7) {
    out.push(finding('flowShape', `The flow has ${steps.length} steps; three to seven is the range.`));
  }
  for (const [index, step] of steps.entries()) {
    const at = step.indexOf('|');
    if (at < 0) {
      out.push(finding('flowShape', `Step ${index + 1} has no "|" between its name and its detail.`));
      continue;
    }
    const name = step.slice(0, at).trim();
    const detail = step.slice(at + 1).trim();
    if (!name || !detail) {
      out.push(finding('flowShape', `Step ${index + 1} has an empty name or detail.`));
    } else if (name.length > 60) {
      out.push(finding('flowShape', `Step ${index + 1}'s name is ${name.length} characters; sixty is the limit.`));
    } else if (detail.length > 160) {
      out.push(finding('flowShape', `Step ${index + 1}'s detail is ${detail.length} characters; 160 is the limit.`));
    }
    if (out.length >= 3) break;
  }
  return out;
};

/* ---------- slugs ---------- */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Slugs that a line presents as a *reference*: the first token of a list item,
 * followed by a separator or the end of the line. A word in a sentence is not
 * cited and is not checked — a validator that rejected every slug-shaped word
 * would refuse "python" in ordinary prose.
 */
function citedSlugs(answer: string): string[] {
  const out: string[] = [];
  for (const raw of answer.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .trim();
    const match = /^`?([a-z0-9]+(?:-[a-z0-9]+)*)`?\s*(?:—|–|-|:|\s|$)/.exec(line);
    if (!match || !SLUG.test(match[1])) continue;
    if (!/[—–:-]/.test(line.slice(match[1].length)) && line.length > match[1].length) {
      /* A bare slug line is a citation; a line that continues in ordinary
         words is prose that happens to start with a slug-shaped word. */
      continue;
    }
    out.push(match[1]);
  }
  return out;
}

const slugsExist: Validator = (answer, ctx) => {
  if (!ctx.slugs) return [];
  const known = new Set(ctx.slugs);
  const missing = [...new Set(citedSlugs(answer))].filter(slug => !known.has(slug));
  return missing.slice(0, 3).map(slug => finding('slugsExist', `There is no project or post with the slug "${slug}".`));
};

/* ---------- mermaid ---------- */

const DIAGRAM_TYPES =
  /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|C4Context|C4Container|block-beta|sankey-beta|xychart-beta|requirementDiagram)\b/i;

function mermaidNodes(source: string): Set<string> {
  const nodes = new Set<string>();
  for (const line of source.split('\n')) {
    const text = line.replace(/%%.*$/, '').trim();
    if (!text || /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|C4\w*|block-beta|sankey-beta|xychart-beta|requirementDiagram)\b/i.test(text)) {
      continue;
    }
    for (const match of text.matchAll(/(^|[\s;|])([A-Za-z][\w-]*)\s*(?=[\[({]|\s*(?:-->|---|==>|-.->|--x|--o|\.->))/g)) {
      if (!DIAGRAM_TYPES.test(match[2])) nodes.add(match[2]);
    }
    for (const match of text.matchAll(/(?:-->|---|==>|-.->|--x|--o|\.->)\s*(?:\|[^|]*\|\s*)?([A-Za-z][\w-]*)/g)) {
      nodes.add(match[1]);
    }
    const named = /^(?:participant|actor|class|state)\s+([A-Za-z][\w-]*)/.exec(text);
    if (named) nodes.add(named[1]);
  }
  return nodes;
}

const mermaidLint: Validator = answer => {
  const fence = /```mermaid\s*\n([\s\S]*?)```/i.exec(answer);
  if (!fence) {
    return [finding('mermaidLint', 'There is no ```mermaid fenced block.')];
  }
  const out: Finding[] = [];
  const source = fence[1];
  const first = source.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  if (!DIAGRAM_TYPES.test(first)) {
    out.push(finding('mermaidLint', `The diagram type "${first.slice(0, 24)}" is not one Mermaid knows.`));
  }
  const count = mermaidNodes(source).size;
  if (count > 12) {
    out.push(finding('mermaidLint', `The diagram has ${count} nodes; twelve is the limit.`));
  }
  for (const [open, close] of [
    ['[', ']'],
    ['(', ')'],
    ['{', '}'],
  ]) {
    const left = source.split(open).length - 1;
    const right = source.split(close).length - 1;
    if (left !== right) {
      out.push(finding('mermaidLint', `The diagram has an unbalanced ${open}${close} pair.`));
      break;
    }
  }
  for (const match of source.matchAll(/\[([^\]]*)\]/g)) {
    if (/[()[\]{}<>"\\]/.test(match[1])) {
      out.push(finding('mermaidLint', 'A node label contains a character Mermaid reads as syntax.'));
      break;
    }
  }
  return out;
};

/* ---------- fit ---------- */

const MARK = /^(\u2705|\u26A0\uFE0F?|\u274C)\s*/;

interface FitRead {
  score: number | null;
  verdict: string;
  marks: number;
  must: { mark: 'met' | 'adjacent' | 'missing'; evidence: string }[];
}

function readFit(answer: string): FitRead {
  const out: FitRead = { score: null, verdict: '', marks: 0, must: [] };
  let section: 'must' | 'nice' | null = null;
  for (const raw of answer.split('\n')) {
    const line = raw.trim();
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = /must/i.test(heading[1]) ? 'must' : /nice/i.test(heading[1]) ? 'nice' : null;
      continue;
    }
    if (!out.verdict) {
      const verdict = /^\**\s*Verdict\s*\**\s*:\s*(.*)$/i.exec(line.replace(/\*{1,2}|_{1,2}/g, ''));
      if (verdict) out.verdict = verdict[1].trim();
    }
    if (out.score === null) {
      const score = /^\**\s*Score\s*\**\s*:\s*\**\s*(\d+(?:\.\d+)?)\s*\/\s*10/i.exec(
        line.replace(/\*{1,2}|_{1,2}/g, ''),
      );
      if (score) out.score = Number(score[1]);
    }
    if (!section) continue;
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!item) continue;
    const marked = MARK.exec(item[1]);
    if (!marked) continue;
    out.marks += 1;
    if (section !== 'must') continue;
    const mark = marked[1].startsWith('\u2705')
      ? 'met'
      : marked[1].startsWith('\u26A0')
        ? 'adjacent'
        : 'missing';
    const rest = item[1].slice(marked[0].length).trim();
    const afterBold = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(rest);
    const evidence = afterBold ? afterBold[2].trim() : rest.split(/\s+[—–-]\s+/).slice(1).join(' — ').trim();
    out.must.push({ mark, evidence });
  }
  return out;
}

const fitShape: Validator = answer => {
  const read = readFit(answer);
  const out: Finding[] = [];
  if (!read.verdict && read.score === null) {
    out.push(finding('fitShape', 'There is no Verdict or Score line.'));
  }
  if (read.score === null) out.push(finding('fitShape', 'The score is missing.'));
  if (!read.marks) out.push(finding('fitShape', 'No requirement line carries ✅, ⚠️ or ❌.'));
  for (const item of read.must) {
    if (item.mark === 'met' && !item.evidence) {
      out.push(finding('fitShape', 'A ✅ requirement cites no evidence.'));
      break;
    }
  }
  return out;
};

const fitScore: Validator = (answer, ctx) => {
  if (ctx.expectedScore === null || ctx.expectedScore === undefined) return [];
  const read = readFit(answer);
  if (read.score === null) return [];
  if (Math.abs(read.score - ctx.expectedScore) <= 2) return [];
  return [
    finding(
      'fitScore',
      `The model scored ${read.score}/10; the marks make it ${ctx.expectedScore}/10.`,
      false,
    ),
  ];
};

/* ---------- channels ---------- */

const withoutPreamble = (value: string): string =>
  value.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();

const channelLimit: Validator = (answer, ctx) => {
  if (!ctx.channel) return [];
  const { limit, unit, expect, subject, label } = ctx.channel;
  const versions = withoutPreamble(answer)
    .split(/\n\s*---\s*\n/)
    .map(version => version.trim())
    .filter(Boolean);
  const out: Finding[] = [];
  if (expect !== undefined && versions.length !== expect) {
    out.push(finding('channelLimit', `Expected ${expect} version${expect === 1 ? '' : 's'}, found ${versions.length}.`));
  }
  for (const [index, version] of versions.entries()) {
    if (subject && !/^\s*Subject\s*:/im.test(version)) {
      out.push(finding('channelLimit', `Version ${index + 1} has no Subject: line.`));
    }
    const words = version.trim() ? version.trim().split(/\s+/).length : 0;
    const count = unit === 'characters' ? version.length : words;
    if (count > limit) {
      out.push(
        finding(
          'channelLimit',
          `Version ${index + 1} is ${count} ${unit}; ${label ?? 'this channel'} allows ${limit}.`,
        ),
      );
    }
  }
  return out;
};

/**
 * The phrases the outreach tasks' own instructions forbid.
 *
 * Exported so the route builds the context from the same list the prompt
 * describes, rather than two copies drifting. `!` is checked by the validator
 * itself and is not repeated here.
 */
export const OUTREACH_BANNED = [
  'I hope this finds you well',
  'I came across your profile',
] as const;

const banned: Validator = (answer, ctx) => {
  const phrases = [...(ctx.banned ?? []), '!'];
  const lower = answer.toLowerCase();
  const hit = phrases.filter(phrase => phrase !== '!' && lower.includes(phrase.toLowerCase()));
  if (lower.includes('!')) hit.push('!');
  return hit
    .slice(0, 3)
    .map(phrase => finding('banned', phrase === '!' ? 'The draft uses an exclamation mark.' : `The draft uses "${phrase}".`));
};

/* ---------- prose with no figure ---------- */

const hasFigure: Validator = (answer, ctx) => {
  const limit = ctx.figureWords ?? 250;
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  for (const line of answer.split('\n')) {
    if (/^##\s+/.test(line)) sections.push({ heading: line.replace(/^##\s+/, '').trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const out: Finding[] = [];
  for (const section of sections) {
    const words = section.lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (words <= limit) continue;
    const has =
      /^\s*!\[/m.test(section.lines.join('\n')) ||
      /^\s*\|.*\|/m.test(section.lines.join('\n')) ||
      /^\s*```/m.test(section.lines.join('\n')) ||
      /^\s*[-*+]\s+/m.test(section.lines.join('\n')) ||
      /^\s*\d+[.)]\s+/m.test(section.lines.join('\n'));
    if (!has) {
      out.push(
        finding(
          'hasFigure',
          `${section.heading ? `"${section.heading}"` : 'The section'} is ${words} words of prose with no figure, table or list.`,
        ),
      );
    }
  }
  return out;
};

/* ---------- the closed table ---------- */

const truncated: Validator = (_answer, ctx) =>
  ctx.stopReason === 'length'
    ? [finding('truncated', 'The answer hit the token ceiling, so it may be cut off.', false)]
    : [];

export const VALIDATORS: Record<ValidatorName, Validator> = {
  shape,
  flowShape,
  slugsExist,
  mermaidLint,
  fitShape,
  fitScore,
  channelLimit,
  banned,
  hasFigure,
  truncated,
};

export const isValidatorName = (value: unknown): value is ValidatorName =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(VALIDATORS, value);

/** Run a list of validators in order, dropping rule that a context cannot judge. */
export function validate(
  names: readonly ValidatorName[],
  answer: string,
  ctx: ValidateContext,
): Finding[] {
  const out: Finding[] = [];
  for (const name of names) {
    const validator = VALIDATORS[name];
    if (validator) out.push(...validator(answer, ctx));
  }
  return out;
}

/**
 * What the one repair turn says.
 *
 * Built from the findings rather than per task, so a new validator gets a
 * repair instruction without a new sentence to keep in step. Each code is
 * named, because the panel shows this line and a person reading it should be
 * able to tell which rule fired.
 */
export function repairInstruction(findings: readonly Finding[]): string {
  const lines = findings.map(item => `- ${item.code}: ${item.message}`);
  return `The answer was rejected by automatic checks. Fix every one of these and return the whole answer again, in exactly the format the task asks for:
${lines.join('\n')}

Return only the corrected answer. No explanation, no preamble, and nothing after it.`;
}
