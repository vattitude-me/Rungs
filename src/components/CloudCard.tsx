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
  const { account, state, conflict, signIn, resolve } = useCloudSync();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (!cloudConfigured || account === undefined) return null;

  // Both sides hold real work. This is the one case that interrupts, because
  // either choice throws away training the user actually did.
  if (conflict) {
    return (
      <div className="flex flex-col gap-2.5 px-3.5 py-3.5 rounded-[14px] bg-surface shadow-sm border border-danger/30">
        <div className="flex items-center gap-2">
          <TriangleAlert size={14} className="text-danger flex-none" />
          <span className="text-[13.5px] font-medium">Two devices, two histories</span>
        </div>
        <div className="text-[12.5px] leading-[1.5] text-neutral-400">
          This phone and your backup both have reps the other doesn't. Keeping
          one means losing the other's, so it's your call.
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void resolve('cloud')}>
            Use the backup
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => void resolve('local')}>
            Keep this phone
          </Button>
        </div>
      </div>
    );
  }

  if (!account) {
    if (dismissed) return null;
    return (
      <div className="flex flex-col gap-2.5 px-3.5 py-3.5 rounded-[14px] bg-surface shadow-sm">
        <div className="flex items-start gap-2.5">
          <CloudUpload size={15} className="text-accent flex-none mt-0.5" />
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">Save your streak</span>
            <span className="text-[12px] leading-[1.45] text-neutral-400">
              Sign in and your reps back up as you go, then come straight back
              on a new phone. Friends and squads are next.
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
        <Button variant="primary" block className="h-10 text-[13.5px]" onClick={() => void signIn()}>
          {state.status === 'syncing' ? 'Opening…' : 'Continue with Google'}
        </Button>
      </div>
    );
  }

  // Signed in: a single quiet line. Nothing to act on unless it says otherwise.
  const label =
    state.status === 'syncing' ? 'Saving…'
    : state.status === 'offline' ? 'Offline · saves when you reconnect'
    : state.status === 'error' ? state.message
    : 'Backed up';

  const Icon =
    state.status === 'syncing' ? RefreshCw
    : state.status === 'offline' ? CloudOff
    : state.status === 'error' ? TriangleAlert
    : Check;

  const tone = state.status === 'error' ? 'text-danger' : 'text-neutral-500';

  return (
    <div className={`flex items-center gap-1.75 px-1 ${tone}`}>
      <Icon size={11.5} className={state.status === 'syncing' ? 'animate-spin' : ''} />
      <span className="text-[11.5px] leading-[1.4] flex-1 truncate">{label}</span>
    </div>
  );
}
