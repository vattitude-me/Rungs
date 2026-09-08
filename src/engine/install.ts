import { Capacitor } from '@capacitor/core';

/**
 * Whether the app is running as an installed app rather than a browser tab.
 *
 * This is the question notifications actually hinge on. iOS only exposes the
 * Push API to Home Screen apps, and on macOS a Dock app is what gets a
 * notification identity of its own rather than borrowing the browser's. A tab
 * can ask for permission and be told yes and still deliver nothing once it's
 * closed, which is the worst of the three outcomes - so the UI asks this
 * before it offers a reminder toggle.
 *
 * `standalone` is the iOS Safari answer; the media query is everyone else's.
 * `minimal-ui` and `window-controls-overlay` count as installed too - they're
 * what a desktop PWA reports when the user has kept a slim toolbar.
 */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  return ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen']
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

/** The platforms tell the user to do different things, and one of them can't
 * be told anything useful at all. */
export type InstallPlatform = 'ios' | 'macos-safari' | 'desktop-chromium' | 'android' | 'unsupported';

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Which set of instructions - or which prompt - this browser needs.
 *
 * Chromium is detected by what it can do rather than by its user agent: a
 * `beforeinstallprompt` event having fired is proof the browser will install,
 * where a UA string is only a guess that survives until the next release. The
 * caller passes what it has captured; without one we fall back to the UA, so
 * the card still says something sensible in the moment before the event lands.
 */
export function installPlatform(canPrompt: boolean): InstallPlatform {
  if (typeof window === 'undefined') return 'unsupported';
  if (canPrompt) return /Android/.test(navigator.userAgent) ? 'android' : 'desktop-chromium';

  const ua = navigator.userAgent;
  if (isIOS()) return 'ios';
  if (/Android/.test(ua)) return 'android';

  // Safari is the one that has to be named by UA - it fires no install event
  // and exposes no capability that separates it from a browser that simply
  // hasn't offered yet. Chrome and Edge both carry "Safari" in their UA, so
  // they have to be excluded explicitly.
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  if (isSafari && /Macintosh/.test(ua)) return 'macos-safari';

  return 'unsupported';
}

/** True when there is nothing to install because this already is the app. */
export function installIrrelevant(): boolean {
  return Capacitor.isNativePlatform() || isInstalled();
}
