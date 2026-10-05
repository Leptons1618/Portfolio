/**
 * The one confirmation every permanent delete on the admin goes through.
 *
 * Deletes used to be a button that changed its label and waited for a second
 * click within five seconds. That is a speed bump, not a confirmation: the
 * second click lands on the same spot as the first, and since decision 18 a
 * deleted row has no copy anywhere — no commit, no history. So a delete is now
 * a dialog that says what goes, offers the reversible control that does what
 * people usually mean (unpublish, hide) as its own button, and enables Delete
 * only once the slug is typed.
 *
 * A native modal `<dialog>`: focus trapping, Escape and the top layer are the
 * platform's. Built in script and rebuilt when a `ClientRouter` swap has taken
 * it out of the document — the media library's arrangement. Every string goes
 * in through `textContent`. Styles are `.modal*` in `admin.css` plus `.cd-*`.
 */

export interface ConfirmDeleteOptions {
  /** What it is, as the author knows it: the post's or project's title. */
  title: string;
  /** What must be typed, and the row's name. */
  slug: string;
  /** The public URL that will 404, shown as code. */
  path: string;
  /** What else goes with it, one line each. */
  consequences?: string[];
  /** The reversible alternative, e.g. "Unpublish instead". */
  alternative?: string;
}

export type DeleteChoice = 'delete' | 'alternative' | null;

let dialog: HTMLDialogElement | null = null;

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

function build(): HTMLDialogElement {
  const d = node('dialog', 'modal modal-narrow cd-modal');
  d.setAttribute('aria-labelledby', 'cd-title');

  const head = node('div', 'modal-head');
  const copy = node('div', 'modal-head-copy');
  copy.append(node('p', 'admin-eyebrow cd-eyebrow', 'Delete for good'));
  const title = node('h2', 'modal-title');
  title.id = 'cd-title';
  copy.append(title);
  head.append(copy);

  const body = node('div', 'modal-body');
  const lede = node('p', 'modal-lede cd-lede');
  const list = node('ul', 'cd-list');
  const label = node('label', 'cd-label');
  label.htmlFor = 'cd-input';
  const input = node('input', 'input cd-input');
  input.id = 'cd-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  body.append(lede, list, label, input);

  const foot = node('div', 'modal-foot');
  const alt = node('button', 'btn btn-secondary cd-alt');
  alt.type = 'button';
  const actions = node('div', 'modal-actions');
  const cancel = node('button', 'btn btn-ghost cd-cancel', 'Cancel');
  cancel.type = 'button';
  const confirm = node('button', 'btn btn-primary cd-confirm', 'Delete');
  confirm.type = 'button';
  actions.append(cancel, confirm);
  foot.append(alt, actions);

  d.append(head, body, foot);
  /* A click on the backdrop is a click on the dialog itself. */
  d.addEventListener('click', event => {
    if (event.target === d) d.close('');
  });
  document.body.append(d);
  return d;
}

/** Ask. Resolves once, from the dialog's `close`, whatever closed it. */
export function confirmDelete(options: ConfirmDeleteOptions): Promise<DeleteChoice> {
  if (!dialog || !dialog.isConnected) dialog = build();
  const d = dialog;
  const q = <T extends HTMLElement>(selector: string) => d.querySelector(selector) as T;

  q('#cd-title').textContent = `Delete “${options.title}”?`;
  const lede = q<HTMLElement>('.cd-lede');
  lede.replaceChildren(
    document.createTextNode('This removes '),
    node('code', '', options.path),
    document.createTextNode(' and its row. There is no copy anywhere to restore it from.'),
  );
  q<HTMLUListElement>('.cd-list').replaceChildren(...(options.consequences ?? []).map(line => node('li', '', line)));
  q<HTMLUListElement>('.cd-list').hidden = !options.consequences?.length;

  const label = q<HTMLLabelElement>('.cd-label');
  label.replaceChildren(document.createTextNode('Type '), node('code', '', options.slug), document.createTextNode(' to confirm'));
  const input = q<HTMLInputElement>('.cd-input');
  input.value = '';
  const confirm = q<HTMLButtonElement>('.cd-confirm');
  confirm.disabled = true;
  const alt = q<HTMLButtonElement>('.cd-alt');
  alt.textContent = options.alternative ?? '';
  alt.hidden = !options.alternative;

  return new Promise(resolve => {
    const matches = () => input.value.trim() === options.slug;
    const onInput = () => {
      confirm.disabled = !matches();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && matches()) {
        event.preventDefault();
        d.close('delete');
      }
    };
    const onConfirm = () => matches() && d.close('delete');
    const onAlt = () => d.close('alternative');
    const onCancel = () => d.close('');
    const onClose = () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      confirm.removeEventListener('click', onConfirm);
      alt.removeEventListener('click', onAlt);
      q('.cd-cancel').removeEventListener('click', onCancel);
      const value = d.returnValue;
      d.returnValue = '';
      resolve(value === 'delete' || value === 'alternative' ? value : null);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    confirm.addEventListener('click', onConfirm);
    alt.addEventListener('click', onAlt);
    q('.cd-cancel').addEventListener('click', onCancel);
    d.addEventListener('close', onClose, { once: true });
    d.returnValue = '';
    d.showModal();
    input.focus();
  });
}
