import { useState } from 'react';
import { CloudUpload, CloudOff, RefreshCw, Check, TriangleAlert } from 'lucide-react';
import Button from './Button';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';

const DISMISSED = 'rungs.cloudPromptDismissed';

function wasDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED) === '1'; } catch { return false; }
}

/** The account entry point on Today. Signed out it's an invitation; signed in
 * it's a status line that stays quiet unless something needs attention. */
export default function CloudCard() {
  const { account, state, signIn, syncNow } = useCloudSync();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (!cloudConfigured || account === undefined) return null;

  if (!account) {
    if (dismissed) return null;
    return (
      <div className="flex flex-col gap-2.5 px-3.5 py-3.5 rounded-[14px] bg-surface shadow-sm">
        <div className="flex items-start gap-2.5">
          <CloudUpload size={15} className="text-accent flex-none mt-0.5" />
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">Save your streak</span>
            <span className="text-[12px] leading-[1.45] text-neutral-400">
              Sign in and your reps sync as you go, so they're already there
              on any phone you use. Friends and squads are next.
            </span>
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setDismissed(true);
              try { localStorage.setItem(DISMISSED, '1'); } catch { /* advisory only */ }
            }}
            className="text-neutral-600 hover:text-text text-[15px] leading-none flex-none px-1"
          >
            ×
          </button>
        </div>
        {state.status === 'error' && (
          <div className="text-[12px] leading-[1.5] text-danger">
            {state.message} Tap the button to try again.
          </div>
        )}
        <Button variant="primary" block className="h-10 text-[13.5px]" onClick={() => void signIn()}>
          {state.status === 'syncing' ? 'Opening…' : 'Continue with Google'}
        </Button>
      </div>
    );
  }

  // Signed in: a single quiet line, and a way to ask for a fresh copy.
  //
  // Syncing already happens on its own - on open, on returning to the app, on
  // reconnecting, and after each set. The button isn't there because the user
  // is expected to press it; it's there for the moment they've just deleted
  // something on their phone, are looking at this screen, and want to see it
  // gone now rather than trust that it will be. Without it the only honest
  // answer to "is this up to date?" is "probably", which is not an answer
  // someone checks a screen for.
  const label =
    state.status === 'syncing' ? 'Syncing…'
    : state.status === 'offline' ? 'Offline · syncs when you reconnect'
    : state.status === 'error' ? state.message
    : 'Synced';

  const Icon =
    state.status === 'syncing' ? RefreshCw
    : state.status === 'offline' ? CloudOff
    : state.status === 'error' ? TriangleAlert
    : Check;

  const tone = state.status === 'error' ? 'text-danger' : 'text-neutral-500';
  const busy = state.status === 'syncing';

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={busy}
      aria-label={busy ? 'Syncing' : 'Refresh from your other devices'}
      className={`flex items-center gap-1.75 px-1 w-full text-left disabled:opacity-100 ${tone}`}
    >
      <Icon size={11.5} className={busy ? 'animate-spin' : ''} />
      <span className="text-[11.5px] leading-[1.4] flex-1 truncate">{label}</span>
      {!busy && (
        <RefreshCw size={10.5} className="flex-none text-neutral-600" aria-hidden />
      )}
    </button>
  );
}
