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
    showAdminError(event.error ?? event.message, 'uncaught error');
  });
  window.addEventListener('unhandledrejection', event => {
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
