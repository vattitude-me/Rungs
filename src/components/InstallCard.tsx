import { useState } from 'react';
import { BellRing, Download, Share, SquarePlus, ChevronDown } from 'lucide-react';
import Button from './Button';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import type { InstallPlatform } from '../engine/install';

/** The manual route, for the browsers that expose no install API. Safari is
 * the whole reason this exists: it installs perfectly well, it just won't be
 * asked to do it in code. */
const STEPS: Record<InstallPlatform, { title: string; steps: string[] } | null> = {
  ios: {
    title: 'Add Rungs to your Home Screen',
    steps: [
      'Tap the Share button in Safari\'s toolbar',
      'Scroll down and tap "Add to Home Screen"',
      'Tap "Add", then open Rungs from your Home Screen',
    ],
  },
  'macos-safari': {
    title: 'Add Rungs to your Dock',
    steps: [
      'Open the File menu in Safari',
      'Choose "Add to Dock…"',
      'Click "Add", then open Rungs from your Dock',
    ],
  },
  'desktop-chromium': null,
  android: null,
  unsupported: null,
};

/**
 * The nudge to install, shown only in a browser tab that isn't the app yet.
 *
 * Reminders are the reason, not tidiness. A tab cannot run when it's closed,
 * and iOS won't hand out push permission to one at all - so on the web the
 * difference between "installed" and "bookmarked" is the difference between
 * getting your window reminders and not. The card says that rather than
 * selling the install on its own merits.
 *
 * Nothing here is dismissable. It disappears the moment the app is installed,
 * which is a better dismiss than a button, and until then it is describing a
 * feature the user is missing rather than advertising one they've declined.
 */
export default function InstallCard() {
  const { needed, platform, canPrompt, promptInstall } = useInstallPrompt();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!needed) return null;

  const manual = STEPS[platform];
  // A browser that can neither prompt nor be talked through it has nothing to
  // offer - showing a card there would be a dead end.
  if (!canPrompt && !manual) return null;

  const onInstall = async () => {
    if (!canPrompt) { setExpanded((v) => !v); return; }
    setBusy(true);
    try { await promptInstall(); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-3.5 rounded-[14px] bg-accent-900">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 flex-none rounded-[11px] bg-accent-800 grid place-items-center text-accent-100">
          <BellRing size={17} strokeWidth={1.9} />
        </span>
        <span className="flex-1 flex flex-col gap-0.75">
          <span className="text-[13.5px] font-medium text-accent-100">
            Install Rungs for reminders
          </span>
          <span className="text-[12px] leading-[1.45] text-accent-200">
            {platform === 'ios'
              ? 'On iPhone, only a Home Screen app can send you window reminders. A browser tab can\'t, even with notifications on.'
              : 'Installed, Rungs can nudge you before each window even when it\'s closed. A browser tab only reminds you while it\'s open.'}
          </span>
        </span>
      </div>

      {expanded && manual && (
        <ol className="flex flex-col gap-1.75 pl-1 pt-0.5">
          {manual.steps.map((step, i) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="w-4.5 h-4.5 flex-none mt-px rounded-full bg-accent-800 grid place-items-center text-[10px] tabular-nums text-accent-100">
                {i + 1}
              </span>
              <span className="text-[12px] leading-[1.45] text-accent-200 flex items-center gap-1 flex-wrap">
                {step}
                {i === 0 && platform === 'ios' && <Share size={12} className="inline text-accent-200" />}
                {i === 1 && platform === 'ios' && <SquarePlus size={12} className="inline text-accent-200" />}
              </span>
            </li>
          ))}
        </ol>
      )}

      <Button
        variant="primary" block className="h-10 text-[13.5px]"
        disabled={busy}
        onClick={() => void onInstall()}
        aria-expanded={manual ? expanded : undefined}
      >
        {canPrompt ? (
          <>
            <Download size={15} strokeWidth={2} />
            {busy ? 'Installing…' : 'Install app'}
          </>
        ) : (
          <>
            {expanded ? 'Hide steps' : manual?.title ?? 'Show me how'}
            <ChevronDown
              size={14} strokeWidth={2}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </Button>
    </div>
  );
}
