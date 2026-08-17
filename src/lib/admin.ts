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
 */
export function onAdminPage(rootSelector: string, init: () => void): void {
  let initialised: Element | null = null;

  const run = () => {
    const root = document.querySelector(rootSelector);
    if (!root || root === initialised) return;
    initialised = root;
    init();
  };

  run();
  document.addEventListener('astro:page-load', run);
}
