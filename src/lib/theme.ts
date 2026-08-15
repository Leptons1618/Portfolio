/**
 * Theme selection — site-wide, so it lives here rather than in `admin.ts`.
 *
 * Modernist is the default and needs no attribute; every other theme is
 * selected by `data-theme` on `<html>`, which is what
 * `src/styles/themes/*.css` keys its token overrides off. The layouts restore
 * the stored choice in an `is:inline` head script so the page never paints in
 * the wrong theme first.
 */

export const THEME_KEY = 'om-theme';

export const THEMES = [
  { id: 'modernist', label: 'Modernist', themeColor: '#f3f2f2' },
  { id: 'blueprint', label: 'Blueprint', themeColor: '#f9f9ff' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** The theme that renders when nothing is stored — no `data-theme` attribute. */
export const DEFAULT_THEME: ThemeId = 'modernist';
