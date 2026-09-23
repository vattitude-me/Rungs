import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/** The colour themes a user can pick in Settings > Appearance.
 *
 * A theme is only a set of CSS variable overrides (see index.css) switched by
 * `data-theme` on <html>, so nothing that draws needs to know which is on.
 * Violet is the original palette and stays the default.
 */
export type ThemeId = 'violet' | 'ocean' | 'lagoon' | 'ember' | 'graphite';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  /** Accent and ground, for the picker's swatch - read before the theme is
   * applied, so they can't come from the live CSS variables. */
  accent: string;
  bg: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'violet', name: 'Violet', accent: '#9184d9', bg: '#161826' },
  { id: 'ocean', name: 'Ocean', accent: '#5f9be3', bg: '#131923' },
  { id: 'lagoon', name: 'Lagoon', accent: '#3db5a6', bg: '#121b1c' },
  { id: 'ember', name: 'Ember', accent: '#e8875a', bg: '#191716' },
  { id: 'graphite', name: 'Graphite', accent: '#b4b8c8', bg: '#151619' },
];

export const DEFAULT_THEME: ThemeId = 'violet';

/** Mirrors the synced setting in localStorage so the right theme is on before
 * the first frame. The setting lives in IndexedDB, which is async - reading
 * only that would paint every launch in Violet and then flick over. */
const STORAGE_KEY = 'rungs.theme';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

function themeOption(id: ThemeId): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** The theme this device last used, for boot. */
export function storedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Puts a theme on screen and remembers it for the next launch.
 *
 * Also recolours what sits outside the WebView's CSS: the Android status bar,
 * and the browser/PWA chrome via `theme-color`. Left alone those stay Violet's
 * navy above an app that is now some other colour.
 */
export function applyTheme(id: ThemeId): void {
  const option = themeOption(id);
  const root = document.documentElement;
  if (option.id === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = option.id;

  try { localStorage.setItem(STORAGE_KEY, option.id); } catch { /* private mode */ }

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', option.bg);

  if (Capacitor.isNativePlatform()) {
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    void StatusBar.setBackgroundColor({ color: option.bg }).catch(() => {});
  }
}

/** `color` at `percent` opacity, for inline styles.
 *
 * The old code wrote tints as literal rgba() and hex-alpha suffixes, which
 * baked Violet into every one of them. color-mix works on a `var(--…)` as
 * well as a hex, so tints follow the theme - and it's what Tailwind's own
 * `/12` opacity modifiers compile to, so it adds no new browser requirement.
 */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
