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

/** The event `applyTheme` fires, so every control showing the theme can follow. */
export const THEME_EVENT = 'om:theme';

export const isThemeId = (value: string | null | undefined): value is ThemeId =>
  THEMES.some(theme => theme.id === value);

/** Whatever `<html>` is in right now. Browser only. */
export function currentTheme(): ThemeId {
  const attr = document.documentElement.dataset.theme ?? null;
  return isThemeId(attr) ? attr : DEFAULT_THEME;
}

/**
 * Put a theme on `<html>` and keep `theme-color` in step. Browser only.
 *
 * There are two controls on this — the rail's toggle and the identity modal's
 * radio group — so the attribute juggling lives here rather than in whichever
 * one happened to be written first, and the event lets the other follow
 * without either knowing the other exists.
 *
 * Applying is separate from choosing (`selectTheme`) because a page load has to
 * do the first without the second: the pre-paint script has already set the
 * attribute from storage, but not the `<meta>`, and correcting that should not
 * write a preference nobody expressed.
 *
 * The `<meta>` is looked up per call: a view transition replaces the whole
 * `<head>`, so a reference taken once would point at a detached tag.
 */
export function applyTheme(id: ThemeId): void {
  if (id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEMES.find(theme => theme.id === id)!.themeColor;

  document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

/** Choose a theme: remember it for the next load, then apply it now. */
export function selectTheme(id: ThemeId): void {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
}
