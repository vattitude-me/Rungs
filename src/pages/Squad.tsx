import { useEffect, useRef, useState } from 'react';
import {
  Check, Copy, Hand, Share2, Trash2, Undo2, UserPlus, X,
} from 'lucide-react';
import Button from '../components/Button';
import Tag from '../components/Tag';
import { getProfile } from '../db';
import { useCloudSync, sharedProfileError } from '../hooks/useCloudSync';
import { useFriends } from '../hooks/useFriends';
import type { Friend, NudgePhraseId } from '../cloud/friends';
import { cloudConfigured } from '../cloud/config';

/** The phrases Squad offers, and how a received one reads.
 *
 * Copied from `cloud/friends` rather than imported, deliberately: importing
 * any value from that module statically pulls the Firestore SDK into the main
 * bundle for every user, including those who never open Squad. The ids are
 * pinned by the Firestore rules, so the two lists cannot drift silently - a
 * phrase that is not in both is refused server-side.
 */
const PHRASES: { id: NudgePhraseId; text: string }[] = [
  { id: 'poke', text: 'nudged you' },
  { id: 'getafterit', text: 'says get after it' },
  { id: 'yourturn', text: "says it's your turn" },
  { id: 'catchup', text: 'is ahead of you today' },
  { id: 'proud', text: 'is proud of you' },
  { id: 'dontbreak', text: "says don't break the streak" },
];

function phraseText(id: string): string {
  return PHRASES.find((p) => p.id === id)?.text ?? 'nudged you';
}

/** How long a removed friend can be brought back.
 *
 * Long enough to notice the row vanish and react, short enough that the
 * removal doesn't feel like it silently didn't happen. Removing is not
 * reversible once it reaches the server - both edges go, and getting back
 * means a fresh request the other person has to accept - so this window is
 * the only safety net there is. */
const UNDO_WINDOW_MS = 6000;

/** "12,480" - thousands separated, because a five-figure rep count read as a
 * solid block of digits is a number nobody can compare at a glance. */
function formatReps(n: number): string {
  return n.toLocaleString();
}

/** Today, as the app's local date. Duplicated from `cloud/friends` for the
 * same bundle reason, and trivially small. */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The invite link a friend can open directly. Deep-links to Squad with the
 * code prefilled, so someone who doesn't have Rungs installs it, signs in, and
 * lands on the request already typed. */
/** Clipboard write that reports whether it actually worked.
 *
 * navigator.clipboard is unavailable or rejects in several places this app
 * runs - a Capacitor WebView without the permission, and any non-secure
 * origin. The old code swallowed that rejection and showed a tick regardless,
 * which is worse than not offering copy at all: the user walks away believing
 * they have the code. The execCommand path is deprecated but still the only
 * fallback those contexts have.
 */
async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than giving up.
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

function inviteLink(code: string): string {
  return `${window.location.origin}/squad?add=${code}`;
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** A stable colour per friend, so the same person keeps the same chip. Hashing
 * the uid rather than the index means the colour doesn't change when the list
 * reorders, which it does constantly - it's sorted by today's progress. */
const CHIP_COLORS = ['#423a6a', '#3f424d', '#2b2741', '#453055', '#2f3a52', '#4a3b3b'];
function chipColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

export default function Squad() {
  const { account, signIn } = useCloudSync();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [nudging, setNudging] = useState<Friend | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Friend | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Friend | null>(null);

  const friends = useFriends(name);
  const codeError = friends.me?.code ? null : (friends.error ?? sharedProfileError());

  // Whether the OS offers a share sheet. Read once into a boolean rather than
  // tested inline: `navigator.share` is a function reference, so a bare
  // truthiness check in a ternary is always true even where sharing is
  // unavailable, and the button would promise a sheet that never opens.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => { getProfile().then((p) => setName(p?.name ?? '')); }, []);

  // An invite link opens straight into the request, so the person following it
  // doesn't have to copy a code out of the URL bar themselves.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('add');
    if (param) setCode(param.toUpperCase());
  }, []);

  const submitCode = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    const result = await friends.addFriend(code);
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) setCode('');
    setBusy(false);
  };

  const send = async (phrase: NudgePhraseId) => {
    if (!nudging) return;
    const target = nudging;
    setNudging(null);
    const result = await friends.nudge(target.uid, phrase);
    setNotice({
      ok: result.ok,
      text: result.ok ? `Sent to ${target.name}.` : result.message,
    });
  };

  /** Starts a removal that can still be taken back.
   *
   * The row goes immediately, because a confirmation that leaves the person
   * sitting there looks like it failed. What it doesn't do is delete anything:
   * the friendship is only torn down when the undo window closes, so the
   * mis-tap this whole flow exists for costs nothing but a moment.
   */
  const pendingRemovalRef = useRef<Friend | null>(null);
  pendingRemovalRef.current = pendingRemoval;

  const beginRemoval = (friend: Friend) => {
    setRemoving(null);
    friends.hide(friend.uid);
    setPendingRemoval(friend);
  };

  const undoRemoval = () => {
    if (!pendingRemoval) return;
    friends.unhide(pendingRemoval.uid);
    setPendingRemoval(null);
  };

  // Commits the held removal once the undo window closes. Also runs on
  // unmount, so navigating away confirms rather than silently abandoning it -
  // leaving the friend hidden but not removed would be the one outcome that
  // matches neither button.
  useEffect(() => {
    if (!pendingRemoval) return;
    const friend = pendingRemoval;
    const commit = () => { void friends.remove(friend.uid); };
    const id = setTimeout(() => {
      commit();
      setPendingRemoval(null);
    }, UNDO_WINDOW_MS);
    return () => {
      clearTimeout(id);
      // Distinguishes "the timer fired" from "this screen went away with a
      // removal still held" - only the latter needs committing here, and
      // setPendingRemoval(null) above has already cleared it in the former.
      if (pendingRemovalRef.current === friend) commit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRemoval]);

  const share = async () => {
    if (!friends.me?.code) return;
    const link = inviteLink(friends.me.code);
    // The native share sheet is the right thing on a phone, where the point is
    // to get this into a specific chat. Clipboard is the desktop fallback.
    if (canShare) {
      await navigator.share({
        title: 'Join me on Rungs',
        text: `Add me on Rungs with code ${friends.me.code}`,
        url: link,
      }).catch(() => {});
      return;
    }
    await copyText(link);
  };

  /** Copies the bare code, for the case the share sheet isn't what's wanted. */
  const copyCode = async (value: string) => {
    await copyText(value);
  };

  const copyText = async (value: string) => {
    const ok = await writeClipboard(value);
    setNotice(ok ? null : { ok: false, text: 'Couldn\'t copy - select the code and copy it by hand.' });
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!cloudConfigured) {
    return (
      <Shell>
        <div className="text-[13px] leading-[1.5] text-neutral-400">
          Squad needs cloud sync, which this build wasn't configured for.
        </div>
      </Shell>
    );
  }

  if (account === undefined) return <Shell />;

  // Friends are other accounts, so there is nothing to show until this device
  // is one. Signing in is the whole prerequisite, so it's the whole screen.
  if (!account) {
    return (
      <Shell>
        <div className="p-[15px] rounded-[15px] flex flex-col gap-3 bg-surface">
          <div className="text-[13px] leading-[1.5] text-neutral-400">
            Squad needs a cloud account, so your friends have something to find.
            Signing in also backs your training up.
          </div>
          <Button variant="primary" block className="h-11.5" onClick={() => void signIn()}>
            Sign in to get started
          </Button>
        </div>
      </Shell>
    );
  }

  const requests = friends.inbox.filter((i) => i.kind === 'request');
  const nudges = friends.inbox.filter((i) => i.kind === 'nudge');

  return (
    <Shell>
      {notice && (
        <button
          onClick={() => setNotice(null)}
          className="p-3 rounded-xl text-left text-[12.5px] leading-[1.45] cursor-pointer"
          style={{
            background: notice.ok ? 'rgba(120,190,150,.12)' : 'rgba(220,130,130,.12)',
            color: notice.ok ? '#9fd8b4' : '#e6a3a3',
          }}
        >
          {notice.text}
        </button>
      )}

      {/* Nudges waiting to be read. Shown above everything: someone took the
          trouble to poke, and burying it under the friend list would waste it. */}
      {nudges.map((item) => (
        <div key={item.id} className="p-3 rounded-xl bg-surface flex items-center gap-2.75">
          <span
            style={{ background: chipColor(item.fromUid) }}
            className="w-8.5 h-8.5 flex-none rounded-full grid place-items-center text-[13px] font-medium"
          >
            {initial(item.fromName)}
          </span>
          <span className="flex-1 text-[13px] leading-[1.4]">
            <span className="font-medium">{item.fromName}</span>{' '}
            <span className="text-neutral-400">
              {item.phrase === 'accepted' ? 'accepted your request' : phraseText(item.phrase ?? '')}
            </span>
          </span>
          <button
            onClick={() => void friends.dismiss(item.id)}
            aria-label="Dismiss"
            className="w-7 h-7 flex-none rounded-full grid place-items-center text-neutral-500 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      ))}

      {/* Incoming friend requests. */}
      {requests.map((item) => (
        <div key={item.id} className="p-3.5 rounded-xl bg-surface flex flex-col gap-2.5">
          <div className="flex items-center gap-2.75">
            <span
              style={{ background: chipColor(item.fromUid) }}
              className="w-8.5 h-8.5 flex-none rounded-full grid place-items-center text-[13px] font-medium"
            >
              {initial(item.fromName)}
            </span>
            <span className="flex-1 text-[13px]">
              <span className="font-medium">{item.fromName}</span>
              <span className="text-neutral-400"> wants to be friends</span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1 h-9.5"
              onClick={() => void friends.accept(item.fromUid)}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              className="flex-1 h-9.5"
              onClick={() => void friends.decline(item.fromUid)}
            >
              Ignore
            </Button>
          </div>
        </div>
      ))}

      {/* The friend list, sorted by who is furthest along today. */}
      {friends.friends === undefined ? (
        <div className="text-[12.5px] text-neutral-500">Loading…</div>
      ) : friends.friends.length === 0 ? (
        <div className="p-[15px] rounded-[15px] bg-surface text-[13px] leading-[1.5] text-neutral-400">
          No friends yet. Share your code below, or enter theirs.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {friends.friends.map((f) => (
            <FriendRow
              key={f.uid}
              friend={f}
              onNudge={() => setNudging(f)}
              onRemove={() => setRemoving(f)}
            />
          ))}
        </div>
      )}

      {/* The undo bar for a removal still in flight. Sits with the list rather
          than floating over the screen: the row it refers to has just left
          this exact spot, so this is where the eye already is. */}
      {pendingRemoval && (
        <div
          className="p-3 rounded-xl flex items-center gap-2.5"
          style={{ background: 'rgba(220,130,130,.12)' }}
        >
          <span className="flex-1 text-[12.5px] leading-[1.45]" style={{ color: '#e6a3a3' }}>
            Removed {pendingRemoval.name}.
          </span>
          <button
            onClick={undoRemoval}
            className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-[12px] font-medium cursor-pointer bg-surface"
          >
            <Undo2 size={13} />
            Undo
          </button>
        </div>
      )}

      {/* Your own code, and the box for someone else's. */}
      <div className="p-[15px] rounded-[15px] bg-surface flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <div className="text-[12.5px] text-neutral-400">Your invite code</div>
          <div className="flex items-center gap-2">
            {/* Selectable, and tappable to copy. In the Android build there is
                no URL bar and no "view source" to fall back on, so a code the
                OS won't let you select is a code you can only transcribe by
                eye - and select-none is the app-wide default for a UI that
                should otherwise feel native. */}
            <span
              onClick={() => { if (friends.me?.code) void copyCode(friends.me.code); }}
              className={`flex-1 text-[19px] font-medium tracking-[0.14em] tabular-nums select-text ${
                friends.me?.code ? 'cursor-pointer' : 'text-neutral-600'
              }`}
              style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
            >
              {friends.me?.code ?? (codeError ? 'Unavailable' : 'Loading…')}
            </span>
            <button
              onClick={() => void share()}
              disabled={!friends.me?.code}
              aria-label="Share invite"
              className="w-9.5 h-9.5 flex-none rounded-full bg-accent-800 grid place-items-center cursor-pointer disabled:opacity-40"
            >
              {copied ? <Check size={17} /> : canShare ? <Share2 size={17} /> : <Copy size={17} />}
            </button>
          </div>
          {codeError ? (
            <div className="text-[11.5px] leading-[1.5] text-danger">
              Couldn't create your invite code: {codeError}
            </div>
          ) : (
            <div className="text-[11.5px] leading-[1.5] text-neutral-500">
              Tap the code to copy it. It's the only way to be added — nobody
              can find you by name or email.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-text/10 pt-3.5">
          <div className="text-[12.5px] text-neutral-400">Add a friend</div>
          <div className="flex items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitCode(); }}
              placeholder="ABC123"
              maxLength={7}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 h-10 px-3 rounded-xl bg-bg text-[15px] tracking-[0.12em] tabular-nums outline-none border border-text/10 focus:border-accent/50"
            />
            <button
              onClick={() => void submitCode()}
              disabled={busy || code.trim().length === 0}
              aria-label="Send request"
              className="w-10 h-10 flex-none rounded-xl bg-accent grid place-items-center cursor-pointer disabled:opacity-40"
            >
              <UserPlus size={17} color="#161826" />
            </button>
          </div>
        </div>
      </div>

      {friends.error && (
        <div className="text-[11.5px] text-neutral-500">
          Couldn't load your squad: {friends.error}
        </div>
      )}

      {nudging && (
        <NudgeSheet
          friend={nudging}
          onPick={(p) => void send(p)}
          onClose={() => setNudging(null)}
        />
      )}

      {removing && (
        <RemoveSheet
          friend={removing}
          onConfirm={() => beginRemoval(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col px-5 pt-4 pb-24 gap-3.75">
      <div className="flex flex-col gap-1.25">
        <div className="text-[22px] font-medium tracking-[-0.02em]">Squad</div>
        <div className="text-[13px] leading-[1.5] text-neutral-400">
          A few people who'll notice if you skip.
        </div>
      </div>
      {children}
    </div>
  );
}

function FriendRow({
  friend, onNudge, onRemove,
}: {
  friend: Friend;
  onNudge: () => void;
  onRemove: () => void;
}) {
  // Figures from a previous day are not today's progress. Showing them as if
  // they were would tell you a friend had already trained when they hadn't.
  const isToday = friend.day === localDay();
  const percent = isToday ? friend.percent : 0;
  const todayReps = isToday ? (friend.todayReps ?? 0) : 0;
  const lifetime = friend.lifetimeReps ?? 0;

  return (
    <div className="p-3 rounded-xl bg-surface flex items-center gap-2.75">
      <span
        style={{ background: chipColor(friend.uid) }}
        className="w-9.5 h-9.5 flex-none rounded-full grid place-items-center text-[14px] font-medium"
      >
        {initial(friend.name)}
      </span>

      <span className="flex-1 flex flex-col gap-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium truncate">{friend.name}</span>
          {friend.streak > 0 && (
            <Tag variant="outline" className="flex-none">{friend.streak}d</Tag>
          )}
        </span>

        {/* Today's reps lead, because that is the number two people can
            actually race on. Percent is kept as the bar rather than a figure -
            it says how far through their own day they are, which is a
            different question from who has done more. */}
        <span className="flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-medium tabular-nums" style={{ color: percent >= 100 ? '#7fd6a2' : '#d2cefd' }}>
            {formatReps(todayReps)}
          </span>
          <span className="text-[10.5px] text-neutral-500">today</span>
          {lifetime > 0 && (
            <span className="text-[10.5px] text-neutral-600 truncate">
              · {formatReps(lifetime)} all-time
            </span>
          )}
        </span>

        <span className="flex items-center gap-1.75">
          <span className="flex-1 h-1.5 rounded-full bg-bg overflow-hidden">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, percent)}%`,
                background: percent >= 100 ? '#7fd6a2' : '#9184d9',
              }}
            />
          </span>
          <span className="text-[10.5px] tabular-nums text-neutral-500 flex-none w-8 text-right">
            {percent}%
          </span>
        </span>
      </span>

      <span className="flex items-center gap-1 flex-none">
        <button
          onClick={onNudge}
          aria-label={`Nudge ${friend.name}`}
          className="w-9 h-9 rounded-full bg-accent-800 grid place-items-center cursor-pointer"
        >
          <Hand size={16} />
        </button>
        <button
          onClick={onRemove}
          aria-label={`Remove ${friend.name}`}
          className="w-7 h-9 grid place-items-center text-neutral-600 cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

/** The removal confirmation.
 *
 * A sheet rather than the two inline buttons this used to be. The inline
 * version put "Remove" exactly where the nudge button had been a moment
 * earlier, so the second tap of a double-tap landed on it - the friend was
 * gone before the user had read anything. A sheet moves the destructive
 * button somewhere the finger isn't already heading, and says who is about to
 * be removed and what it costs.
 */
function RemoveSheet({
  friend, onConfirm, onClose,
}: {
  friend: Friend;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-[20px] bg-surface p-5 pb-8 flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.75">
          <span
            style={{ background: chipColor(friend.uid) }}
            className="w-9.5 h-9.5 flex-none rounded-full grid place-items-center text-[14px] font-medium"
          >
            {initial(friend.name)}
          </span>
          <span className="flex-1 text-[15px] font-medium">Remove {friend.name}?</span>
        </div>

        <div className="text-[12.5px] leading-[1.5] text-neutral-400">
          You'll both drop off each other's squad, and neither of you can nudge
          the other. To undo it properly you'd need their code again.
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 h-11" onClick={onClose}>
            Keep
          </Button>
          <button
            onClick={onConfirm}
            className="flex-1 h-11 rounded-xl text-[14px] font-medium cursor-pointer"
            style={{ background: 'rgba(220,130,130,.15)', color: '#e6a3a3' }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/** The phrase picker.
 *
 * Every message Rungs can send is on this sheet. There is no free-text field,
 * which is what makes the feature safe to ship without any moderation: a
 * friend can encourage you, and that is the entire vocabulary.
 */
function NudgeSheet({
  friend, onPick, onClose,
}: {
  friend: Friend;
  onPick: (phrase: NudgePhraseId) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-[20px] bg-surface p-5 pb-8 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium">Nudge {friend.name}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full grid place-items-center text-neutral-500 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {PHRASES.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className="h-11 px-3.5 rounded-xl bg-bg text-left text-[13.5px] cursor-pointer"
            >
              {/* Shown as the recipient will read it, name and all, so there
                  is no guessing what a phrase turns into once sent. */}
              <span className="text-neutral-400">{friend.name} sees: </span>
              <span>You {p.text}</span>
            </button>
          ))}
        </div>

        <div className="text-[11px] leading-[1.5] text-neutral-500">
          Two nudges per friend per day, so it stays a nudge.
        </div>
      </div>
    </div>
  );
}
