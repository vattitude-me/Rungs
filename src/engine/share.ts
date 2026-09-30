/** Sharing Rungs with someone - the whole acquisition plan, really: people
 * start training because a friend did.
 *
 * The native share sheet where there is one, the clipboard where there isn't.
 * Resolves true only when something actually happened, so the caller can
 * confirm honestly ("Copied") rather than ticking regardless. */

export const APP_URL = 'https://rungs.vattitude.ca';

export async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(text: string, url: string = APP_URL): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Rungs', text, url });
      return false; // The sheet was its own confirmation.
    } catch (e) {
      // Dismissing the sheet is a choice, not a failure to fall back from.
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  return writeClipboard(`${text} ${url}`);
}
