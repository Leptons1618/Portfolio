/**
 * The project frontmatter form's controls: chips, counters, a live card
 * preview, a completeness check, and a per-field review of what the assistant
 * changed.
 *
 * Browser code, mounted by `/admin/projects/[slug]`. Everything here keeps the
 * form's own inputs as the value — the chips hide their input rather than
 * replace it, exactly as `select.ts` and `switch.ts` do — so `readProject()`,
 * `trackDirty()`, the assistant's `applyLive()` and every Revert keep working
 * on the fields they always did. Programmatic writes fire no events, so each
 * control also chains the input's `value` setter (after whoever wrapped it
 * first, the rule `mountAutoGrow()` states) and repaints from there.
 *
 * Styles are in `admin.css`, because every node below is made by script and a
 * page's scoped `<style>` never reaches one. Decision **60**.
 */

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const PROTOS: Record<string, PropertyDescriptor | undefined> = {
  INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'),
  TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'),
  SELECT: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'),
};

/**
 * Call `onChange` whenever the field's value changes, typed or assigned.
 *
 * Chained onto whatever setter is already on the element, so a second watcher,
 * `mountAutoGrow()`, `attachImageUpload()` and `select.ts` all keep running.
 */
export function watchValue(field: Field, onChange: () => void): void {
  field.addEventListener('input', onChange);
  field.addEventListener('change', onChange);
  const native = Object.getOwnPropertyDescriptor(field, 'value') ?? PROTOS[field.tagName];
  if (!native?.get || !native.set) return;
  Object.defineProperty(field, 'value', {
    configurable: true,
    get: () => native.get!.call(field),
    set: (value: string) => {
      native.set!.call(field, value);
      onChange();
    },
  });
}

const splitList = (value: string) =>
  value
    .split(/[,\n]/)
    .map(part => part.trim())
    .filter(Boolean);

/**
 * A comma list as removable chips, over the input that still holds the list.
 *
 * Enter or a comma adds what is typed; Backspace in an empty entry takes the
 * last chip; a paste with commas in it becomes several. Duplicates are dropped
 * case-insensitively, because "PyTorch, pytorch" is one stack item. The input
 * keeps `a, b, c` — the shape `csv()` has always read.
 */
export function mountChips(input: HTMLInputElement, placeholder: string): void {
  const host = document.createElement('div');
  host.className = 'input pf-chips';
  host.dataset.for = input.id;
  const list = document.createElement('ul');
  list.className = 'pf-chip-list';
  const entry = document.createElement('input');
  entry.className = 'pf-chip-entry';
  entry.type = 'text';
  entry.placeholder = placeholder;
  entry.setAttribute('aria-label', `Add to ${document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? 'the list'}`);
  host.append(list, entry);
  input.after(host);
  input.hidden = true;
  /* The label points at the hidden input; send it to the entry instead. */
  document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)?.addEventListener('click', event => {
    event.preventDefault();
    entry.focus();
  });
  host.addEventListener('click', event => {
    if (event.target === host || event.target === list) entry.focus();
  });

  const items = () => splitList(input.value);
  const write = (next: string[]) => {
    const seen = new Set<string>();
    const unique = next.filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    input.value = unique.join(', ');
    /* A typed change is an edit: the dirty tracker listens for this. */
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const render = () => {
    const values = items();
    list.replaceChildren(
      ...values.map((value, index) => {
        const li = document.createElement('li');
        li.className = 'tag tag-neutral pf-chip';
        const text = document.createElement('span');
        text.textContent = value;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pf-chip-x';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${value}`);
        remove.addEventListener('click', () => {
          write(values.filter((_, at) => at !== index));
          entry.focus();
        });
        li.append(text, remove);
        return li;
      }),
    );
    host.dataset.count = String(values.length);
  };

  const commit = () => {
    const added = splitList(entry.value);
    if (!added.length) return;
    entry.value = '';
    write([...items(), ...added]);
  };

  entry.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !entry.value) {
      const values = items();
      if (values.length) write(values.slice(0, -1));
    }
  });
  entry.addEventListener('blur', commit);
  entry.addEventListener('paste', () => setTimeout(() => {
    if (entry.value.includes(',')) commit();
  }));

  watchValue(input, render);
  render();
}

/**
 * A live count under a field, with the range the text should fall in.
 *
 * `unit` is characters or lines. Outside the range the count turns to the
 * warning tone; nothing is refused — the form's own checks still decide that.
 */
export function mountCounter(
  field: HTMLInputElement | HTMLTextAreaElement,
  range: { min?: number; max: number; unit: 'chars' | 'lines'; hint?: string },
): void {
  const out = document.createElement('p');
  out.className = 'pf-counter';
  out.setAttribute('aria-live', 'polite');
  (field.closest('.field') ?? field.parentElement)?.append(out);
  const paint = () => {
    const value = field.value;
    const count =
      range.unit === 'lines'
        ? value.split('\n').filter(line => line.trim()).length
        : value.trim().length;
    const word = range.unit === 'lines' ? (count === 1 ? 'line' : 'lines') : 'characters';
    const low = range.min !== undefined && count > 0 && count < range.min;
    const high = count > range.max;
    out.dataset.tone = high || low ? 'warn' : 'ok';
    const target = range.min !== undefined ? `${range.min}–${range.max}` : `up to ${range.max}`;
    out.textContent = `${count} ${word} · aim for ${target}${range.hint ? ` · ${range.hint}` : ''}`;
  };
  watchValue(field, paint);
  paint();
}

/** What the preview and the completeness check read. */
export interface FrontmatterValues {
  title: string;
  summary: string;
  category: string;
  categoryLabel: string;
  status: string;
  year: string;
  rank: string;
  tags: string[];
  stack: string[];
  repo: string;
  demo: string;
  hero: string;
  highlights: string[];
  hasCaseStudy: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The project card as `/projects` renders it, plus the page header's chips.
 *
 * The same classes `ProjectCard.astro` uses where they are global (`card`,
 * `card-kicker`, `card-title`, `card-body`, `tag`, `btn`), so a theme change
 * shows here too. Four tags, like the card; the rest are counted.
 */
export function renderPreview(host: HTMLElement, values: FrontmatterValues): void {
  const card = el('article', 'card elev-sm pf-preview');
  if (values.hero) {
    const figure = el('div', 'grayscale pf-preview-hero');
    const img = el('img');
    img.src = values.hero;
    img.alt = '';
    img.loading = 'lazy';
    figure.append(img);
    card.append(figure);
  }
  card.append(el('span', 'card-kicker', `${values.year || '—'} · ${values.status || '—'}`));
  card.append(el('h3', 'card-title', values.title || 'Untitled project'));
  card.append(el('p', 'card-body', values.summary || 'The summary goes here — it is the card body and the meta description.'));
  const tags = el('div', 'pf-preview-tags');
  for (const tag of values.tags.slice(0, 4)) tags.append(el('span', 'tag tag-neutral', tag));
  if (values.tags.length > 4) tags.append(el('span', 'pf-preview-more', `+${values.tags.length - 4}`));
  card.append(tags);
  const actions = el('div', 'pf-preview-actions');
  actions.append(el('span', 'btn btn-primary btn-sm', values.hasCaseStudy ? 'Case study' : 'Details'));
  if (values.demo) actions.append(el('span', 'btn btn-secondary btn-sm', 'Demo ↗'));
  if (values.repo) actions.append(el('span', 'btn btn-secondary btn-sm', 'Repo ↗'));
  card.append(actions);

  const chips = el('div', 'pf-preview-chips');
  for (const text of [values.categoryLabel, values.year, values.status].filter(Boolean)) {
    chips.append(el('span', 'tag tag-neutral', text));
  }
  const page = el('div', 'pf-preview-page');
  page.append(
    el('p', 'pf-preview-caption', 'Project page header'),
    chips,
    el('p', 'pf-preview-counts',
      `${values.highlights.length} highlight${values.highlights.length === 1 ? '' : 's'} · ` +
      `${values.stack.length} stack item${values.stack.length === 1 ? '' : 's'}` +
      (values.rank ? ` · featured #${values.rank}` : '')),
  );

  host.replaceChildren(card, page);
}

/** One line of the completeness check. */
export interface Check {
  label: string;
  done: boolean;
  hint: string;
}

/**
 * What a complete project page needs, as a checklist.
 *
 * Advice, not validation — `readProject()` still decides what may be saved.
 * The thresholds are the ones the frontmatter task writes to, so a run of the
 * assistant should tick every line it is responsible for.
 */
export function completeness(values: FrontmatterValues): Check[] {
  const summary = values.summary.trim().length;
  return [
    { label: 'Title', done: Boolean(values.title.trim()), hint: 'The card heading and the page title.' },
    { label: 'Summary, 120–220 characters', done: summary >= 120 && summary <= 240, hint: `${summary} now.` },
    { label: 'Category', done: Boolean(values.category) && values.category !== 'other', hint: '“Other” hides it from every filter but one.' },
    { label: 'Year and status', done: Boolean(values.year && values.status), hint: 'Shown on the card kicker.' },
    { label: '4+ tags', done: values.tags.length >= 4, hint: `${values.tags.length} now.` },
    { label: '5+ stack items', done: values.stack.length >= 5, hint: `${values.stack.length} now.` },
    { label: '4+ highlights', done: values.highlights.length >= 4, hint: `${values.highlights.length} now.` },
    { label: 'Repository or demo link', done: Boolean(values.repo || values.demo), hint: 'The page’s main buttons.' },
    { label: 'Hero image', done: Boolean(values.hero), hint: 'Optional, but the card is plain without it.' },
  ];
}

export function renderChecklist(host: HTMLElement, checks: Check[]): void {
  const done = checks.filter(check => check.done).length;
  const meter = el('div', 'pf-meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(checks.length));
  meter.setAttribute('aria-valuenow', String(done));
  meter.setAttribute('aria-label', 'Frontmatter completeness');
  const fill = el('span', 'pf-meter-fill');
  fill.style.width = `${Math.round((done / checks.length) * 100)}%`;
  meter.append(fill);
  const list = el('ul', 'pf-checks');
  for (const check of checks) {
    const li = el('li', check.done ? 'is-done' : '');
    li.append(el('span', 'pf-check-mark', check.done ? '✓' : '·'), el('span', '', check.label));
    if (!check.done) li.title = check.hint;
    list.append(li);
  }
  host.replaceChildren(el('p', 'pf-meter-label', `${done} of ${checks.length} complete`), meter, list);
}

/**
 * Which fields a run changed, with Keep and Revert on each.
 *
 * `before` is the undo snapshot the run took; anything whose value now differs
 * is marked on its `.field`, and the bar at the top of the form counts them.
 * Keep clears a mark, Revert puts that one field back — the per-field version
 * of the panel's all-or-nothing Undo. Any later edit to a marked field keeps it
 * and clears the mark: once the author has touched it, it is theirs.
 */
export function reviewChanges(options: {
  before: Record<string, string>;
  inputs: Record<string, Field>;
  labels: Record<string, string>;
  bar: HTMLElement;
  onWrite: () => void;
}): { clear: () => void; count: number } {
  const { before, inputs, labels, bar, onWrite } = options;
  const marks = new Map<string, { field: HTMLElement; row: HTMLElement; off: () => void }>();

  const paintBar = () => {
    if (!marks.size) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    bar.hidden = false;
    const keepAll = el('button', 'btn btn-secondary btn-sm', 'Keep all');
    keepAll.type = 'button';
    keepAll.addEventListener('click', () => clear());
    const revertAll = el('button', 'btn btn-secondary btn-sm', 'Revert all');
    revertAll.type = 'button';
    revertAll.addEventListener('click', () => {
      for (const key of [...marks.keys()]) revert(key);
    });
    const names = [...marks.keys()].map(key => labels[key] ?? key).join(', ');
    bar.replaceChildren(
      el('span', 'pf-review-text', `The assistant changed ${marks.size} field${marks.size === 1 ? '' : 's'}: ${names}. Review each, or:`),
      keepAll,
      revertAll,
    );
  };

  const unmark = (key: string) => {
    const mark = marks.get(key);
    if (!mark) return;
    mark.off();
    mark.row.remove();
    delete mark.field.dataset.aiChanged;
    marks.delete(key);
    paintBar();
  };

  const revert = (key: string) => {
    const input = inputs[key];
    const mark = marks.get(key);
    if (!input || !mark) return;
    mark.off();
    input.value = before[key] ?? '';
    unmark(key);
    onWrite();
  };

  for (const [key, input] of Object.entries(inputs)) {
    if ((before[key] ?? '') === input.value) continue;
    const field = (input.closest('.field') as HTMLElement | null) ?? input.parentElement;
    if (!field) continue;
    field.dataset.aiChanged = 'true';
    const row = el('div', 'pf-review');
    const was = (before[key] ?? '').trim();
    row.append(
      el('span', 'pf-review-was', was ? `Was: ${was.length > 90 ? `${was.slice(0, 90)}…` : was}` : 'Was empty.'),
    );
    const keep = el('button', 'pf-review-btn', 'Keep');
    keep.type = 'button';
    keep.addEventListener('click', () => unmark(key));
    const back = el('button', 'pf-review-btn', 'Revert');
    back.type = 'button';
    back.addEventListener('click', () => revert(key));
    const buttons = el('span', 'pf-review-actions');
    buttons.append(keep, back);
    row.append(buttons);
    field.append(row);
    /* A person editing the field has decided; the mark goes. */
    const onEdit = () => unmark(key);
    input.addEventListener('input', onEdit, { once: true });
    marks.set(key, { field, row, off: () => input.removeEventListener('input', onEdit) });
  }

  const clear = () => {
    for (const key of [...marks.keys()]) unmark(key);
  };
  paintBar();
  return { clear, count: marks.size };
}
