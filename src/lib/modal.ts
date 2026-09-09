/**
 * Admin dialogs, coexisting with the writing assistant.
 *
 * Native `<dialog>` elements opened with `showModal()` live in the top layer,
 * and the platform makes every modal below the topmost one inert: opening the
 * assistant with `showModal()` over the import form (or the media library, or
 * the provider dialog) froze the form underneath until the panel closed — while
 * a run was still streaming into that very form.
 *
 * The fix is to never stack two modals. The assistant always opens modeless
 * (`show()`), and any modal that is already open when it arrives is stepped
 * down to modeless for the duration: `close()` followed by `show()` keeps the
 * element, its position in the DOM and every field value — only the top-layer
 * membership goes. When the panel closes, whatever is still open steps back
 * up. A dialog opened *while* the panel is up goes through `showAdminModal()`,
 * which makes the same choice at that end.
 *
 * Two transitions, both synchronous, both guarded:
 *
 *   - `close()` fires a `close` event, and the media library settles its
 *     pending pick from exactly that event. The transitions set
 *     `data-downgrading` around the pair so that listener can tell a step
 *     down/up apart from a real dismissal. Anything else listening for
 *     `close` on an admin dialog must do the same.
 *   - Modeless dialogs do not close on Escape or trap focus — which is the
 *     point while the panel is up (both surfaces stay usable), and the reason
 *     everything steps back up when it closes.
 *
 * Browser-only. Imported by `assist-panel.ts` and by the screens that raise
 * their own dialogs.
 */

/** While present, a `close` event is a step down/up, not a dismissal. */
const TRANSIT = 'data-downgrading';

/** A dialog stepped down while the assistant is up, to step back up after. */
const DOWNGRADED = 'data-was-modal';

const ASSIST_ID = 'assist-dialog';

/** Whether the assistant panel is currently open. */
export function isAssistOpen(): boolean {
  const panel = document.getElementById(ASSIST_ID);
  return panel instanceof HTMLDialogElement && panel.open;
}

function isTopLayerModal(dialog: HTMLDialogElement): boolean {
  if (!dialog.open) return false;
  try {
    return dialog.matches(':modal');
  } catch {
    /* `:modal` is widely supported; if a browser does not parse it, fall
       back to assuming an open dialog outside the assistant is modal. */
    return dialog.id !== ASSIST_ID;
  }
}

/** Run `job` with the transit guard held, so `close` listeners can ignore it. */
function transit(dialog: HTMLDialogElement, job: () => void): void {
  dialog.setAttribute(TRANSIT, '');
  try {
    job();
  } finally {
    dialog.removeAttribute(TRANSIT);
  }
}

/** Whether this `close` event is a step down/up rather than a dismissal. */
export function isDowngradeTransit(dialog: HTMLDialogElement): boolean {
  return dialog.hasAttribute(TRANSIT);
}

/**
 * Step every open modal except the assistant down to modeless.
 *
 * Called when the assistant opens. Values, focus aside, are untouched —
 * `close()` on a dialog clears nothing, and `show()` reopens the same node.
 */
export function downgradeOpenModals(): void {
  wireGlobal();
  for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) {
    if (dialog.id === ASSIST_ID) continue;
    /* `hasAttribute`, not `in dialog.dataset`: dataset keys are camelCase
       (`wasModal`), so the dashed form never matches and an already-stepped
       dialog would be closed and reopened pointlessly on every panel open. */
    if (dialog.hasAttribute(DOWNGRADED)) continue;
    if (!isTopLayerModal(dialog)) continue;
    dialog.dataset.wasModal = '';
    dialog.classList.add('modal-downgraded');
    transit(dialog, () => {
      dialog.close();
      dialog.show();
    });
  }
  syncFreeze();
}

/**
 * Step whatever is still open back up to modal.
 *
 * Called when the assistant closes. A dialog dismissed while the panel was
 * up is already closed, so its marker is just cleared — reopening it is the
 * opener's decision, not this one's.
 */
export function restoreDowngradedModals(): void {
  for (const dialog of Array.from(
    document.querySelectorAll<HTMLDialogElement>(`dialog[${DOWNGRADED}]`),
  )) {
    if (dialog.id === ASSIST_ID) continue;
    delete dialog.dataset.wasModal;
    dialog.classList.remove('modal-downgraded');
    if (!dialog.open) continue;
    transit(dialog, () => {
      dialog.close();
      dialog.showModal();
    });
  }
  syncFreeze();
}

/**
 * Open an admin dialog, staying usable alongside the assistant when it is up.
 *
 * Without the panel this is `showModal()` exactly as before — backdrop, focus
 * trap, Escape. With it, the dialog opens modeless and marked, so the panel's
 * close steps it back up with the rest.
 */
export function showAdminModal(dialog: HTMLDialogElement): void {
  wireGlobal();
  if (dialog.open) return;
  if (!isAssistOpen()) {
    dialog.showModal();
    return;
  }
  dialog.dataset.wasModal = '';
  dialog.classList.add('modal-downgraded');
  dialog.show();
  syncFreeze();
}

/* ---------- Escape while stepped down ----------
 *
 * A modeless dialog leaves the top layer, which takes Escape-to-close with
 * it — and deliberately nothing else. There is no replacement dim: a dimmed
 * page reads as "you cannot touch this", and touching both surfaces is the
 * point of stepping down at all. The stepped-down dialog keeps its border
 * and shadow, which is elevation enough.
 *
 * Escape closes the stepped-down dialog the event came from — but never
 * through the assistant (which closes itself) and never while a popover is
 * open (the select menus live in `document.body`, outside any dialog, so the
 * event's dialog ancestor would otherwise name the wrong thing to close).
 * A `close()` here carries no transit flag: it is a real dismissal.
 */

/* ---------- the frozen page ----------
 *
 * Two coexisting dialogs need the page behind them to *say* it is not the
 * thing in front. A lone modal gets that free from the top layer — backdrop
 * and inertness — and stepping down to modeless gives both away, so it is
 * re-applied here.
 *
 * Here, and not on a screen. This started as wiring inside
 * `/admin/projects`, naming that screen's own root and its own two dialogs,
 * which meant the *other* places the same coexistence happens — the provider
 * and model dialogs on `/admin/ai`, and the media library, which opens from
 * the journal and project editors — dimmed nothing at all: a stepped-down
 * dialog floating over a page that stayed bright and fully clickable. It also
 * missed the media library **on the projects screen itself**, because that
 * dialog was not one of the two the screen knew to watch. The state being
 * described is `modal.ts`'s, so the description belongs beside it, and then
 * there is one of it.
 *
 * What is frozen is every direct child of `.admin-main` that is not a
 * `<dialog>`, plus the sidebar rail — which lives outside the main region and
 * persists across page swaps, so it freezes separately or else stays bright
 * and clickable beside a dimmed page. Every dialog on the admin, the
 * assistant included, is a direct child of that region, which is what makes
 * `:not(dialog)` the whole rule rather than a list of ids.
 */

/** The marker `admin.css` dims from. */
const FROZEN = 'data-asx-freeze';

const frozenParts = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.admin-main > :not(dialog)'),
  ...document.querySelectorAll<HTMLElement>('.admin-sidebar'),
];

/**
 * Match the page's frozen state to what is actually open.
 *
 * Derived rather than tracked: two dialogs and a panel produce more orderings
 * than a counter survives, and every one of them ends here. Frozen exactly
 * when the assistant is up *and* something else is open — a lone modal
 * freezes the page by itself, and a lone panel is meant to be used beside a
 * live page.
 */
export function syncFreeze(): void {
  const main = document.querySelector('.admin-main');
  if (!main) return;

  const others = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).filter(
    dialog => dialog.id !== ASSIST_ID,
  );
  const frozen = isAssistOpen() && others.length > 0;

  for (const part of frozenParts()) part.inert = frozen;
  document.body.toggleAttribute(FROZEN, frozen);
}

let wired = false;

function popoverOpen(): boolean {
  try {
    return document.querySelector(':popover-open') !== null;
  } catch {
    return false;
  }
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (!isAssistOpen()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const host = target.closest('dialog[data-was-modal][open]');
  if (!(host instanceof HTMLDialogElement) || host.id === ASSIST_ID) return;
  if (popoverOpen()) return;
  event.preventDefault();
  host.close();
}

function wireGlobal(): void {
  if (wired) return;
  wired = true;
  document.addEventListener('keydown', onEscape);
  /* Capture, because `close` does not bubble: a listener on `document` sees a
     dialog's own `close` on the way *down* to it and nowhere else. This is what
     makes the freeze correct for a dismissal nothing here initiated — the X, a
     backdrop click, Escape, or a screen closing its own dialog in code. */
  document.addEventListener('close', () => syncFreeze(), true);
  /* `show()` fires no event, so the panel announces itself. */
  document.addEventListener('asx-open', () => syncFreeze());
  document.addEventListener('asx-close', () => syncFreeze());
  /* A navigation mid-draft swaps the page out from under a set freeze while
     `<body>` — where the marker lives — persists across the swap. */
  document.addEventListener('astro:page-load', () => {
    document.body.removeAttribute(FROZEN);
    syncFreeze();
  });
}
