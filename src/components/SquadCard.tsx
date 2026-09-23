import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { getProfile } from '../db';
import { useCloudSync } from '../hooks/useCloudSync';
import { useFriends } from '../hooks/useFriends';
import { cloudConfigured } from '../cloud/config';
import Avatar from './Avatar';

/** Today's standings, on the home screen.
 *
 * Squad was a tab you had to remember to open, which meant the friends were
 * only motivating on the days you already felt like being motivated. This puts
 * the one number that makes it a contest - reps banked today - where it is
 * seen on the way to the workout instead of after it.
 *
 * Everything here is deliberately cheap to be wrong about. It renders nothing
 * at all unless there is a signed-in account with at least one friend, so it
 * never occupies space to say "you have no squad", and it never blocks Today
 * on a network read: the list arrives when it arrives.
 */

/** How many rows fit before the card starts competing with the day's plan.
 * Enough to show a podium and where the user sits against it. */
const VISIBLE_ROWS = 4;

function formatReps(n: number): string {
  return n.toLocaleString();
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Standing {
  uid: string;
  name: string;
  todayReps: number;
  lifetimeReps: number;
  percent: number;
  isMe: boolean;
}

export default function SquadCard({ myReps }: { myReps: number }) {
  const navigate = useNavigate();
  const { account } = useCloudSync();
  const [name, setName] = useState('');
  const friends = useFriends(name);

  useEffect(() => { getProfile().then((p) => setName(p?.name ?? '')); }, []);

  if (!cloudConfigured || !account) return null;
  // `undefined` is still loading, and an empty squad has nothing to say. Both
  // render nothing rather than a placeholder - an empty card on the home
  // screen every day is worse than no card.
  if (!friends.friends || friends.friends.length === 0) return null;

  const today = localDay();

  // The user is a row in their own leaderboard. Ranking friends and then
  // stating the user's position separately is the version that doesn't work:
  // the interesting fact is almost always who is directly above you, and that
  // only reads if everyone is in one list.
  const standings: Standing[] = [
    ...friends.friends.map((f) => {
      const fresh = f.day === today;
      return {
        uid: f.uid,
        name: f.name,
        todayReps: fresh ? (f.todayReps ?? 0) : 0,
        lifetimeReps: f.lifetimeReps ?? 0,
        percent: fresh ? f.percent : 0,
        isMe: false,
      };
    }),
    {
      uid: account.uid,
      name: 'You',
      todayReps: myReps,
      lifetimeReps: friends.me?.lifetimeReps ?? 0,
      percent: friends.me?.day === today ? (friends.me?.percent ?? 0) : 0,
      isMe: true,
    },
  ].sort((a, b) => b.todayReps - a.todayReps || a.name.localeCompare(b.name));

  const myRank = standings.findIndex((s) => s.isMe) + 1;
  const leader = standings[0];

  // Always show the user's row even when they're below the cut, so the card
  // never hides the one line the reader is actually looking for.
  const top = standings.slice(0, VISIBLE_ROWS);
  const rows = top.some((s) => s.isMe)
    ? top
    : [...standings.slice(0, VISIBLE_ROWS - 1), standings[myRank - 1]];

  const ahead = myRank > 1 ? standings[myRank - 2] : null;
  const gap = ahead ? ahead.todayReps - myReps : 0;

  return (
    <div className="flex flex-col gap-2.25">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">SQUAD TODAY</span>
        <button
          onClick={() => navigate('/squad')}
          className="min-h-8 px-1 -mr-1 text-[11.5px] text-neutral-500 cursor-pointer"
        >
          See all ›
        </button>
      </div>

      <button
        onClick={() => navigate('/squad')}
        className="p-3 rounded-[13px] bg-surface flex flex-col gap-2 text-left cursor-pointer"
      >
        {rows.map((s) => {
          const rank = standings.indexOf(s) + 1;
          return (
            <div key={s.uid} className="flex items-center gap-2.5">
              <span className="w-4 flex-none text-[11px] tabular-nums text-neutral-600 text-right">
                {rank}
              </span>
              <Avatar uid={s.uid} name={s.name} size={28} isMe={s.isMe} />
              <span className={`flex-1 text-[12.5px] truncate ${s.isMe ? 'font-medium' : 'text-neutral-300'}`}>
                {s.name}
              </span>
              {s.lifetimeReps > 0 && (
                <span className="text-[10px] tabular-nums text-neutral-600 flex-none">
                  {formatReps(s.lifetimeReps)}
                </span>
              )}
              <span
                className={`text-[12.5px] font-medium tabular-nums flex-none w-11 text-right ${
                  s.percent >= 100 ? 'text-success' : s.isMe ? 'text-accent-300' : 'text-neutral-500'
                }`}
              >
                {formatReps(s.todayReps)}
              </span>
            </div>
          );
        })}
      </button>

      {/* One line of stakes. Which line depends entirely on where the user
          sits, because "you're 40 behind Ravi" and "you're leading" are the
          two things worth saying and they're never both true. */}
      <div className="flex gap-2.5 items-center px-3.5 py-3 rounded-[13px] bg-accent-900">
        <Users size={15} className="flex-none text-accent-200" />
        <span className="text-[12.5px] leading-[1.5] text-accent-200">
          {myRank === 1
            ? standings.length > 1 && standings[1].todayReps === myReps && myReps === 0
              ? 'Nobody has started today. First rep takes the lead.'
              : `You're leading the squad today${myReps > 0 ? ` on ${formatReps(myReps)} reps` : ''}.`
            : gap <= 0
              ? `Level with ${ahead?.name} — next set puts you ahead.`
              : `${formatReps(gap)} rep${gap === 1 ? '' : 's'} behind ${ahead?.name}. ${leader.name} leads on ${formatReps(leader.todayReps)}.`}
        </span>
      </div>
    </div>
  );
}
