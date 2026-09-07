import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, HardDrive, WifiOff, Share2, Trash2, CloudOff } from 'lucide-react';
import Button from '../components/Button';
import ListRow from '../components/ListRow';
import { resetAllData } from '../db';
import { cloudConfigured } from '../cloud/config';

const CONFIRM_PHRASE = 'DELETE';

export default function DataPrivacy() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const handleReset = async () => {
    await resetAllData();
    // A full reload (not client-side navigate) so every in-memory copy of
    // the now-deleted profile/settings is dropped, not just this page's.
    window.location.href = window.location.origin + window.location.pathname;
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-6 gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <div className="text-[15px] font-medium">Data &amp; privacy</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[22px] font-medium tracking-[-0.02em]">Your data stays on this phone</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          {cloudConfigured
            ? 'Nothing leaves this device unless you ask it to. Everything you see here is the whole story.'
            : 'Rungs has no server and no account. Everything you see here is the whole story.'}
        </div>
      </div>

      <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
        <ListRow
          isFirst icon={<HardDrive size={14} />} title="Stored on-device only"
          subtitle="Profile, baseline tests, set logs, streaks: all in this browser's local storage"
        />
        <ListRow
          icon={<WifiOff size={14} />} title="No tracking, ever"
          subtitle="No analytics, no ads, no third-party trackers, no data sold or shared"
        />
        {cloudConfigured ? (
          <ListRow
            icon={<CloudOff size={14} />} title="Backup only when you tap it"
            subtitle="Nothing uploads automatically. Sign in and back up, and the copy is readable only by you"
          />
        ) : (
          <ListRow
            icon={<Share2 size={14} />} title="Nothing shared with third parties"
            subtitle="There is no one to share it with: no accounts, no ads, no backend"
          />
        )}
      </div>

      <div className="text-[11.5px] leading-[1.5] text-neutral-500">
        {cloudConfigured
          ? "Uninstalling the app or clearing this browser's site data deletes the local copy permanently. If you've backed up, that copy lives under your Google account until you delete it - day-by-day set detail is kept for six months, while your daily totals, streak and max tests are kept in full."
          : "Uninstalling the app or clearing this browser's site data deletes it permanently. There's no cloud copy to restore from yet: accounts and sync are planned for a future update."}
      </div>

      <div className="flex flex-col gap-1.75 mt-2">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">DANGER ZONE</span>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst icon={<Trash2 size={14} />} title="Delete all data"
            subtitle="Erases your profile and every logged rep, right now"
            trailing={
              !confirming && (
                <Button
                  variant="danger" className="h-8 px-3 text-xs flex-none"
                  onClick={() => setConfirming(true)}
                >
                  Delete
                </Button>
              )
            }
          />
          {confirming && (
            <div className="flex flex-col gap-2.5 px-4 pt-1 pb-4">
              <div className="text-[12.5px] leading-[1.5] text-neutral-400">
                This can't be undone. Type <span className="text-text font-medium">{CONFIRM_PHRASE}</span> to confirm.
              </div>
              <input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="h-10 px-3 rounded-md bg-bg border border-neutral-800 text-sm text-text placeholder:text-neutral-600 focus-visible:outline-2 focus-visible:outline-danger"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary" className="flex-1"
                  onClick={() => { setConfirming(false); setConfirmText(''); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger" className="flex-1"
                  disabled={confirmText !== CONFIRM_PHRASE}
                  onClick={handleReset}
                >
                  Delete everything
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
