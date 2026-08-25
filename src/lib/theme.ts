/**
 * Theme selection — site-wide, so it lives here rather than in `admin.ts`.
 *
 * There are two independent choices, and keeping them independent is the whole
 * design:
 *
 *   - **Which palette family**, written to `data-theme` on `<html>`. Classic is
 *     the default and needs no attribute; every other theme keys its token
 *     overrides off its own id in `src/styles/themes/*.css`.
 *   - **Light or dark within it**, written to `data-mode`. Three states, not
 *     two: `light`, `dark`, and *unset*, which means "follow the OS" and is
 *     what a first-time visitor gets. Unset is an absent attribute rather than
 *     `data-mode="system"`, because the stylesheets resolve it with
 *     `@media (prefers-color-scheme: dark)` and a rule cannot match the absence
 *     of a value it was given.
 *
 * Collapsing the two into one list — Classic, Classic Dark, Blueprint,
 * Blueprint Dark — was the alternative, and it fails on the obvious gesture:
 * someone reading in dark who switches family expects to still be in dark.
 * Two attributes make that free; one list makes it a lookup table nobody
 * maintains.
 *
 * The layouts restore both in an `is:inline` head script so the page never
 * paints in the wrong theme first.
 */

export const THEME_KEY = 'om-theme';
export const MODE_KEY = 'om-mode';

/**
 * `themeColor` is a pair because the `<meta>` is a single value and the browser
 * chrome around the page should match the ground it is next to. One entry per
 * mode rather than a `color-mix`, because a meta tag is parsed by the OS and
 * not by the CSS engine.
 */
export const THEMES = [
  { id: 'classic', label: 'Classic', themeColor: { light: '#fcfbf8', dark: '#0c0b09' } },
  { id: 'blueprint', label: 'Blueprint', themeColor: { light: '#f9f9ff', dark: '#0a111e' } },
  { id: 'nocturne', label: 'Nocturne', themeColor: { light: '#fafafa', dark: '#0a0a0c' } },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** The theme that renders when nothing is stored — no `data-theme` attribute. */
export const DEFAULT_THEME: ThemeId = 'classic';

/** What a person can choose. `system` is stored; it is never an attribute. */
export const MODES = ['system', 'light', 'dark'] as const;
export type ModeChoice = (typeof MODES)[number];
/** What actually renders, once `system` has been resolved against the OS. */
export type Mode = 'light' | 'dark';

/** The event `applyTheme`/`applyMode` fire, so every control can follow. */
export const THEME_EVENT = 'om:theme';

export const isThemeId = (value: string | null | undefined): value is ThemeId =>
  THEMES.some(theme => theme.id === value);

export const isMode = (value: string | null | undefined): value is ModeChoice =>
  MODES.includes(value as ModeChoice);

/** Whatever `<html>` is in right now. Browser only. */
export function currentTheme(): ThemeId {
  const attr = document.documentElement.dataset.theme ?? null;
  return isThemeId(attr) ? attr : DEFAULT_THEME;
}

/** What was *chosen*, which may be `system`. Browser only. */
export function currentMode(): ModeChoice {
  const stored = localStorage.getItem(MODE_KEY);
  return isMode(stored) ? stored : 'system';
}

/** What is actually on screen, with `system` resolved. Browser only. */
export function resolvedMode(): Mode {
  const chosen = currentMode();
  if (chosen !== 'system') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Keep `<meta name="theme-color">` in step with whatever is showing.
 *
 * Looked up per call: a view transition replaces the whole `<head>`, so a
 * reference taken once would point at a detached tag.
 */
function paintChrome(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const theme = THEMES.find(entry => entry.id === currentTheme()) ?? THEMES[0];
  meta.content = theme.themeColor[resolvedMode()];
}

/**
 * Put a theme on `<html>`. Browser only.
 *
 * Applying is separate from choosing (`selectTheme`) because a page load has to
 * do the first without the second: the pre-paint script has already set the
 * attribute from storage, but not the `<meta>`, and correcting that should not
 * write a preference nobody expressed.
 */
export function applyTheme(id: ThemeId): void {
  if (id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;

  paintChrome();
  document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

/**
 * Put a mode on `<html>`. Browser only.
 *
 * `system` *removes* the attribute rather than setting it, which is what hands
 * the decision back to `prefers-color-scheme` in the stylesheets.
 */
export function applyMode(choice: ModeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = choice;

  paintChrome();
  document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: currentTheme() }));
}

/** Choose a theme: remember it for the next load, then apply it now. */
export function selectTheme(id: ThemeId): void {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
}

/** Choose a mode: remember it for the next load, then apply it now. */
export function selectMode(choice: ModeChoice): void {
  localStorage.setItem(MODE_KEY, choice);
  applyMode(choice);
}

/**
 * Restore both from storage and correct the `<meta>`. Browser only.
 *
 * What every control calls on mount. The pre-paint script has already set the
 * attributes, so this is idempotent by design — its real job is the `<meta>`,
 * which an inline script deliberately does not touch because it would have to
 * duplicate the theme table to do it.
 */
export function syncTheme(): void {
  applyTheme(currentTheme());
  applyMode(currentMode());
}
