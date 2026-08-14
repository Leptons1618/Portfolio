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
  projectVisibility: 'om-admin-project-visibility',
} as const;

/** Every draft key, for the dashboard's clear-all action. */
export const ALL_ADMIN_KEYS = Object.values(ADMIN_KEYS);

/** Sidebar collapse state — UI chrome, not authored content, so cleared separately. */
export const SIDEBAR_KEY = 'om-admin-sidebar-collapsed';
