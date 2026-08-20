/**
 * localStorage keys for the admin surface. The admin screens are the only
 * writers; the dashboard's "Clear Local Drafts" is the only reader of the
 * whole set, so the names live here rather than being retyped per page.
 *
 * Imported by client `<script>` blocks as well as frontmatter — Astro bundles
 * both through Vite.
 */
export const ADMIN_KEYS = {
  journalDraft: 'om-admin-journal-draft',
  resumeDraft: 'om-admin-resume-draft',
  settings: 'om-admin-settings',
} as const;

/** Every draft key, for the dashboard's clear-all action. */
export const ALL_ADMIN_KEYS = Object.values(ADMIN_KEYS);

/** Sidebar collapse state — UI chrome, not authored content, so cleared separately. */
export const SIDEBAR_KEY = 'om-admin-sidebar-collapsed';

/**
 * The error boundary's host element, rendered once per page by `AdminLayout`.
 *
 * Named here rather than in the component because both halves need it and the
 * reporting half lives in this module — the same reason the storage keys do.
 */
export const ERROR_BOUNDARY_ID = 'admin-error-boundary';

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message || cause.name;
  if (typeof cause === 'string' && cause) return cause;
  return 'Something in this screen stopped working.';
};

/**
 * Show a failure instead of leaving a screen that silently does nothing.
 *
 * Every admin screen is a page of controls wired up by one `<script>`. If that
 * script throws — a renamed element, a GitHub response in a shape it did not
 * expect — the markup still renders and every button quietly does nothing,
 * which is the worst possible failure for a surface whose buttons write to a
 * repository. This turns it into something visible and legible instead.
 *
 * Built out of text nodes: the message can come from a thrown `Error` whose
 * text originated at GitHub, and it never goes near an HTML parser.
 */
export function showAdminError(cause: unknown, context?: string): void {
  console.error(context ? `[admin: ${context}]` : '[admin]', cause);

  const host = document.getElementById(ERROR_BOUNDARY_ID);
  if (!host) return;

  const line = host.querySelector<HTMLElement>('[data-role="message"]');
  const where = host.querySelector<HTMLElement>('[data-role="context"]');
  if (line) line.textContent = errorMessage(cause);
  if (where) where.textContent = context ?? window.location.pathname;
  host.hidden = false;
}

let boundaryMounted = false;

/* The three `DOMException` names a view transition uses to say it did not
   finish. None of them means a screen is broken. */
const TRANSITION_ABORTS = new Set(['AbortError', 'InvalidStateError', 'TimeoutError']);

/**
 * Whether a rejection is the router aborting a view transition rather than a
 * screen falling over.
 *
 * `AdminLayout` mounts `<ClientRouter />`, and Astro's router drives every
 * navigation through `document.startViewTransition()`. When a second
 * navigation begins before the first has finished — two clicks in the rail,
 * a click during a slow fetch, a tab going to the background mid-swap — the
 * browser abandons the running transition and rejects its `finished` promise
 * with `InvalidStateError: Transition was aborted because of invalid state`
 * (or `AbortError: Transition was skipped`). The router attaches only a
 * `.finally()` to that promise, and `.finally()` on a rejected promise returns
 * a rejected promise, so nothing ever handles it and it surfaces here as an
 * `unhandledrejection`.
 *
 * The navigation it belongs to *succeeded* — the swap happened, the page is on
 * screen — so reporting it painted a full-width SCREEN FAULT panel over a
 * screen that was working perfectly, complete with a Reload button and copy
 * saying nothing was saved. That is worse than the console line it replaced:
 * the boundary exists so a real failure cannot be mistaken for a working
 * screen, and crying wolf on every double click is the fastest way to teach
 * someone to ignore it.
 *
 * Deliberately narrow. It is not enough for the name to match — an `AbortError`
 * is also what an aborted `fetch` throws, and that one is worth seeing — so the
 * message has to name a transition as well, or be empty, which is what a
 * `DOMException` raised with no text looks like.
 */
function isTransitionAbort(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const { name, message } = cause as { name?: unknown; message?: unknown };
  if (typeof name !== 'string' || !TRANSITION_ABORTS.has(name)) return false;
  if (typeof message !== 'string' || message === '') return true;
  return /transition/i.test(message);
}

/**
 * Catch what a `try` around each handler cannot: a throw inside an event
 * listener, and a rejected promise nobody awaited.
 *
 * Mounted once per session — `AdminLayout`'s script, like every admin script,
 * is evaluated a single time even though the layout's DOM is rebuilt on each
 * navigation. `showAdminError` therefore looks the host up per call rather than
 * holding a reference to a node that a view transition has since replaced.
 */
export function mountAdminErrorBoundary(): void {
  if (boundaryMounted) return;
  boundaryMounted = true;

  window.addEventListener('error', event => {
    if (isTransitionAbort(event.error)) return;
    showAdminError(event.error ?? event.message, 'uncaught error');
  });
  window.addEventListener('unhandledrejection', event => {
    if (isTransitionAbort(event.reason)) {
      /* Handled, and handling it means doing nothing. `preventDefault` also
         keeps the browser from logging it as uncaught, which is the other half
         of the noise. */
      event.preventDefault();
      console.debug('[admin] view transition aborted — navigation completed anyway', event.reason);
      return;
    }
    showAdminError(event.reason, 'unhandled rejection');
  });

  /* A navigation is a fresh screen, so last screen's failure should not follow
     it. The listener is registered here, once, for the same reason. */
  document.addEventListener('astro:page-load', () => {
    const host = document.getElementById(ERROR_BOUNDARY_ID);
    if (host) host.hidden = true;
  });
}

/**
 * Run an admin page's script now, and again after every navigation to it.
 *
 * `AdminLayout` mounts Astro's `<ClientRouter />` so the sidebar can persist
 * across navigation instead of being rebuilt. That turns each page's
 * `<script>` into a module the browser executes at most once per session:
 * Astro re-inserts the same `src` when you return to a screen, and the module
 * registry declines to run it a second time. So a page script cannot just be
 * top-level code any more — it has to be something that can be re-run.
 *
 * Both entry points are needed. `astro:page-load` covers every navigation but
 * is *not* dispatched for the first, server-rendered page; the immediate call
 * covers that one. `rootSelector` guards both: the listener outlives the page
 * that registered it, so every screen would otherwise try to initialise every
 * other screen, and remembering which element was initialised keeps a first
 * visit from running twice.
 *
 * A throw out of `init` is reported through the error boundary rather than
 * being left in the console: it means none of this screen's controls got wired
 * up, and the page would otherwise look finished and do nothing.
 */
/**
 * Wire an ARIA tablist inside `host`, and answer which tab is showing.
 *
 * Two admin screens split a long single column into tabs — the journal editor
 * (write / preview) and a project's page (frontmatter / case study) — and both
 * want the same three things: one panel visible, the roving-focus keyboard
 * behaviour a tablist is supposed to have, and a way to switch tabs from
 * somewhere else on the page.
 *
 * The markup is the contract, so nothing here builds DOM: `host` is the
 * `[role="tablist"]` element, and each `[role="tab"]` inside it names the panel
 * it shows through `aria-controls`. Panels are hidden with the `hidden`
 * attribute rather than a class, so a panel that is not showing is out of the
 * accessibility tree and its form controls are skipped by sequential focus —
 * which is why a panel must not also carry a page-scoped class that sets
 * `display`, since Astro's scoping would then outrank `.tab-panel[hidden]`.
 *
 * Called from inside `onAdminPage`, so it re-runs per navigation against the
 * freshly-swapped DOM. It holds no module state for that reason.
 */
export function wireTabs(host: HTMLElement, onSelect?: (id: string) => void) {
  const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

  const select = (id: string) => {
    tabs.forEach(tab => {
      const on = tab.getAttribute('aria-controls') === id;
      tab.setAttribute('aria-selected', String(on));
      /* Only the selected tab is tabbable — arrow keys move between them, which
         is what a tablist trades its Tab stops for. */
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !on;
    });
    onSelect?.(id);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.getAttribute('aria-controls')!));
    tab.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      next.focus();
      select(next.getAttribute('aria-controls')!);
    });
  });

  /* Whatever the server marked selected wins the first paint, so the panel the
     page wants open does not depend on this running. */
  const initial = tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
  if (initial) select(initial.getAttribute('aria-controls')!);

  return { select, current: () => tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.getAttribute('aria-controls') ?? null };
}

export function onAdminPage(rootSelector: string, init: () => void): void {
  let initialised: Element | null = null;

  const run = () => {
    const root = document.querySelector(rootSelector);
    if (!root || root === initialised) return;
    initialised = root;
    try {
      init();
    } catch (error) {
      showAdminError(error, `${rootSelector} failed to start`);
    }
  };

  run();
  document.addEventListener('astro:page-load', run);
}

/* ==========================================================================
   Toasts — the surface's one transient-feedback channel.
   ========================================================================== */

/**
 * The toast host, rendered once by `AdminLayout` and `transition:persist`ed.
 *
 * Named here for the same reason the error boundary's id is: both halves need
 * it, and the half that writes into it is this module rather than the
 * component that renders it.
 */
export const TOAST_HOST_ID = 'admin-toasts';

export type ToastTone = 'pending' | 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  href: string;
  /** External links open in a tab; an admin URL on this origin should not. */
  external?: boolean;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** A single link on the toast — the live page a save produced, usually. */
  action?: ToastAction;
  /** ms before it retires itself. `0` keeps it up until something dismisses it. */
  duration?: number;
}

/** A toast that is still on screen, so a pending one can become its own result. */
export interface ToastHandle {
  update(message: string, options?: ToastOptions): void;
  dismiss(): void;
}

/* Long enough to read, short enough not to stack up. An error stays roughly
   twice as long because it is the one you have to act on, and `pending` never
   retires on its own — whatever started it is what ends it. */
const TOAST_DURATION: Record<ToastTone, number> = {
  pending: 0,
  success: 4500,
  info: 4500,
  error: 9000,
};

/* A glyph rather than an icon component: this is built in the browser, and
   pulling `astro-icon`'s build-time inlined SVG into a client module is not
   something that integration does. Mono type carries these three shapes. */
const TOAST_GLYPH: Record<Exclude<ToastTone, 'pending'>, string> = {
  success: '✓',
  error: '!',
  info: '·',
};

/* Four is where a corner stack stops being a stack and starts being a wall.
   Anything older than that has gone unread anyway. */
const MAX_TOASTS = 4;

/**
 * The host, found or made.
 *
 * Looked up per call rather than held, because the layout's DOM is rebuilt on
 * every navigation while this module is evaluated once — the same reason
 * `showAdminError` looks the boundary up. The fallback matters more than it
 * looks: a toast is often the *only* report a save produced, so it must not
 * depend on a layout element having rendered.
 */
function toastHost(): HTMLElement {
  let host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    host.className = 'toast-host';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Notifications');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('popover', 'manual');
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Put the toast stack in the top layer, above anything already there.
 *
 * Half the writes on this surface start inside a `<dialog>` — the import
 * form's Create, the repository list's Add — and a native dialog renders in the
 * top layer, which no `z-index` reaches. A toast raised behind one is a toast
 * nobody sees, and the dialog it is hiding behind is frequently the thing the
 * message is about.
 *
 * A popover is promoted to that same layer, and the layer is ordered by *when*
 * each element entered it — so hiding and re-showing on every toast is what
 * puts the stack above a dialog that opened after the last one. The cost is one
 * pair of calls per toast, and the calls are cheap.
 *
 * Wrapped, because none of this is load-bearing: without `popover` support
 * (or with the element mid-swap and not yet connected) the host is still a
 * fixed-position element at `z-index: 80`, which is the behaviour this surface
 * had before and is correct everywhere except on top of a dialog.
 */
function raiseHost(host: HTMLElement): void {
  if (typeof (host as HTMLElement & { showPopover?: unknown }).showPopover !== 'function') return;
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    /* No top layer available. The stylesheet's own positioning still applies. */
  }
}

/**
 * Say what just happened, without a screen having to own a line for it.
 *
 * Every write on this surface reports into a message line near the control
 * that started it, which works right up until that control is in a dialog that
 * closes, below the fold, or on a row that has scrolled away. The lines stay —
 * they are the durable record of what that control did — and this is the
 * transient half, visible wherever the author happens to be looking.
 *
 * Built out of text nodes, like the error boundary and for the same reason: a
 * failure message can have originated at GitHub or at D1, and none of it goes
 * near an HTML parser.
 *
 * Returns a handle, so the usual shape of a save is one toast rather than
 * three: open a `pending` one, then `update()` it with the outcome.
 */
export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const host = toastHost();

  const element = document.createElement('div');
  element.className = 'toast';

  const mark = document.createElement('span');
  mark.className = 'toast-mark';
  mark.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('div');
  copy.className = 'toast-copy';

  const line = document.createElement('p');
  line.className = 'toast-message';
  copy.appendChild(line);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';

  element.append(mark, copy, close);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let removed = false;

  const dismiss = () => {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    element.classList.add('is-leaving');
    /* Matches the leave transition in `admin.css`. A timeout rather than
       `transitionend`, which never fires under `prefers-reduced-motion`. */
    setTimeout(() => element.remove(), 200);
  };

  close.addEventListener('click', dismiss);

  /* Reading one is a reason not to take it away. The timer restarts on the way
     out rather than resuming, which is the forgiving direction to round. */
  let currentDuration = 0;
  const arm = () => {
    clearTimeout(timer);
    if (currentDuration > 0) timer = setTimeout(dismiss, currentDuration);
  };
  element.addEventListener('pointerenter', () => clearTimeout(timer));
  element.addEventListener('pointerleave', arm);

  const apply = (text: string, next: ToastOptions) => {
    const tone = next.tone ?? 'info';
    element.dataset.tone = tone;
    /* An error interrupts; everything else is announced when the reader is
       between things. */
    element.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    mark.replaceChildren();
    if (tone === 'pending') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      mark.appendChild(spinner);
    } else {
      mark.textContent = TOAST_GLYPH[tone];
    }

    line.textContent = text;

    /* Replaced wholesale on every update: a pending toast that becomes an
       error must not keep the link a success would have added. */
    copy.querySelector('.toast-action')?.remove();
    if (next.action) {
      const anchor = document.createElement('a');
      anchor.className = 'toast-action';
      anchor.href = next.action.href;
      anchor.textContent = next.action.label;
      if (next.action.external !== false) {
        anchor.target = '_blank';
        anchor.rel = 'noopener';
      }
      copy.appendChild(anchor);
    }

    currentDuration = next.duration ?? TOAST_DURATION[tone];
    arm();
  };

  apply(message, options);
  host.appendChild(element);
  raiseHost(host);

  /* Two frames: the first commits the entry state with the element in the
     document, the second animates off it. One frame is not reliably enough. */
  requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add('is-in')));

  /* Oldest first, and never a pending one — that is a job still running, and
     taking its toast away would leave nothing on screen saying so. */
  const live = Array.from(host.querySelectorAll<HTMLElement>('.toast:not(.is-leaving)'));
  for (const stale of live.slice(0, Math.max(0, live.length - MAX_TOASTS))) {
    if (stale.dataset.tone !== 'pending') {
      stale.querySelector<HTMLButtonElement>('.toast-close')?.click();
    }
  }

  return {
    update: (text, next = {}) => {
      if (removed) return;
      apply(text, next);
    },
    dismiss,
  };
}

/**
 * Say something else on a button, temporarily, and be able to take it back.
 *
 * Almost every button on this surface carries an SVG that `astro-icon` inlined
 * at build time, and `button.textContent = 'Confirm delete'` **deletes it** —
 * the same trap the sidebar's collapse chevron documents. Worse, the restore
 * is written the same way, so the icon does not come back: the delete buttons
 * on this surface lost their trash glyph the first time they were armed and
 * never had it again for the life of the page.
 *
 * The children are moved aside instead of rewritten. One WeakMap, and it
 * cannot lose anything. `null` puts the original nodes back.
 *
 * The prior `disabled` is remembered too, so restoring cannot enable a control
 * that was disabled for another reason — a signed-out screen, for one.
 */
const stashedLabel = new WeakMap<HTMLElement, { nodes: Node[]; disabled: boolean }>();

function stash(button: HTMLButtonElement): void {
  if (stashedLabel.has(button)) return;
  stashedLabel.set(button, { nodes: Array.from(button.childNodes), disabled: button.disabled });
}

export function setLabel(button: HTMLButtonElement, label: string | null): void {
  if (label === null) {
    const saved = stashedLabel.get(button);
    if (!saved) return;
    stashedLabel.delete(button);
    button.replaceChildren(...saved.nodes);
    button.disabled = saved.disabled;
    button.removeAttribute('aria-busy');
    return;
  }

  stash(button);
  button.replaceChildren(document.createTextNode(label));
}

/**
 * Turn a button into its own progress indicator for the length of one request.
 *
 * A disabled button says "not now"; a disabled button with a turning ring says
 * "this one, right now, and it has not finished". On a surface where every
 * primary action is a network round trip, the difference is whether a slow save
 * looks like work in progress or like a dead click.
 *
 * Built on `setLabel`, so it inherits the same guarantee about the icon.
 */
export function setBusy(button: HTMLButtonElement, busy: boolean, label = 'Working…'): void {
  if (!busy) {
    setLabel(button, null);
    return;
  }
  if (stashedLabel.has(button) && button.getAttribute('aria-busy') === 'true') return;

  stash(button);
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  button.replaceChildren(spinner, document.createTextNode(label));
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
}

/* ---------- undo for the assistants ---------- */

/**
 * One assistant run's worth of "what these fields said before".
 *
 * `label` is what the button offers to take back — "the draft", "the summary" —
 * because after three runs "Undo" alone does not say which one is next.
 */
export interface UndoEntry {
  label: string;
  values: Record<string, string>;
}

/** What an editor gets back from `undoRing()`. */
export interface UndoRing {
  /** Snapshot the fields a run is about to overwrite. */
  push(entry: UndoEntry): void;
  /** The most recent snapshot, removed. `null` when there is nothing left. */
  pop(): UndoEntry | null;
  /** The most recent snapshot, left in place — for labelling the button. */
  peek(): UndoEntry | null;
  /** How many steps back are still available. */
  readonly depth: number;
  /** Forget everything. Used when the thing being edited is replaced outright. */
  clear(): void;
}

/**
 * A bounded stack of field snapshots, most recent first.
 *
 * The assistants write straight into the form, which is the feature — an author
 * watches a title appear letter by letter rather than reading it in a panel and
 * pressing Insert. What makes that reasonable rather than reckless is that it
 * is takeable back, and for a while "takeable back" meant one slot: the last
 * run, and only until the next one started.
 *
 * One slot is wrong for how these get used. Tasks are run in sequence —
 * generate the frontmatter, then rewrite the summary, then rewrite it again
 * with a different steer — and it is the *second* one back that the author
 * wants when the third turns out worse than what they had. With one slot, the
 * only route to that is retyping it.
 *
 * Three, and not more, for two reasons. A ring deep enough to be a document
 * history is a document history, and this is not one — nothing here survives a
 * reload, because a snapshot of an unsaved form outliving the page is a
 * different and much worse feature. And the entries hold whole field values,
 * including a post body: three copies of a long draft is nothing, thirty is a
 * tab that grows all afternoon.
 *
 * It holds plain strings and knows nothing about inputs. Which fields an entry
 * covers is the caller's business, and it has to be — undoing a summary rewrite
 * must not revert the paragraph typed beside it while the model was running.
 */
export function undoRing(depth = 3): UndoRing {
  const entries: UndoEntry[] = [];

  return {
    push(entry) {
      entries.unshift(entry);
      /* Oldest out. `length = depth` rather than `pop()` in a loop: the array
         only ever grows by one per push, but a caller that changed `depth`
         would otherwise leave the excess behind for good. */
      if (entries.length > depth) entries.length = depth;
    },
    pop: () => entries.shift() ?? null,
    peek: () => entries[0] ?? null,
    get depth() {
      return entries.length;
    },
    clear() {
      entries.length = 0;
    },
  };
}

/* ---------- fields that grow with what is in them ---------- */

/**
 * Keep a `textarea[data-grow]` as tall as its content.
 *
 * A summary field is two rows because a summary is one sentence. The assistant
 * writes into those same fields, and a rewrite that lands four sentences turns
 * the field into a two-row window onto its own text — which is exactly when the
 * author is trying to read what arrived.
 *
 * Opt-in by attribute rather than applied to every textarea: the journal body
 * and the case-study write-up are panes with a height of their own, one of them
 * resizable by hand, and growing those would fight the layout instead of
 * helping it. A ceiling comes from `max-height` in `admin.css`, so a long value
 * scrolls rather than pushing the Save button off the bottom of the page.
 *
 * The `value` setter is overridden for the same reason `select.ts` and
 * `image-upload.ts` override theirs: the assistant assigns `.value` on every
 * frame while it streams, and a property assignment fires no `input` event.
 */
export function mountAutoGrow(): void {
  const grow = (field: HTMLTextAreaElement) => {
    /* Measured from nothing each time — `scrollHeight` on an element already
       tall enough only ever reports the height it was given, so a field that
       grew could never shrink again. */
    field.style.height = 'auto';
    /* A field inside a hidden tab panel measures zero, and writing `0px` onto
       it is a field that opens flat when its tab is next selected. Leaving the
       height unset is what the stylesheet's `min-height` is for, and the next
       keystroke or streamed token measures it properly. */
    field.style.height = field.scrollHeight ? `${field.scrollHeight}px` : '';
  };

  const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  const attach = (field: HTMLTextAreaElement) => {
    if (field.dataset.growing) return;
    field.dataset.growing = 'on';
    field.addEventListener('input', () => grow(field));

    if (native?.get && native.set) {
      Object.defineProperty(field, 'value', {
        configurable: true,
        get: () => native.get!.call(field),
        set: (value: string) => {
          native.set!.call(field, value);
          grow(field);
        },
      });
    }
  };

  const run = () => {
    document.querySelectorAll<HTMLTextAreaElement>('textarea[data-grow]').forEach(field => {
      attach(field);
      /* Also on every navigation: a screen that client-routed back arrives with
         its fields filled from the server and no event to react to. */
      grow(field);
    });
  };

  run();
  document.addEventListener('astro:page-load', run);
}
