import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Flame, Play, Share2, Sparkles, X } from 'lucide-react';
import ProgressRing from '../components/ProgressRing';
import LitCard from '../components/LitCard';
import Button from '../components/Button';
import CloudButton from '../components/CloudButton';
import InstallCard from '../components/InstallCard';
import SquadCard from '../components/SquadCard';
import MovementPicker from '../components/MovementPicker';
import { getProfile, getSetLogs, getStreak, saveProfile } from '../db';
import { generateDayPlan, reflowMissedWindows } from '../engine/planGenerator';
import { localDate, dayIndexFor, nowMinutes, timeToMinutes } from '../engine/dates';
import { shouldRebaseline, summariseItems } from '../engine/coach';
import { movementFor, repsOf, equipmentOf, type Movement } from '../data/movements';
import { shareText } from '../engine/share';
import type { Exercise, Profile, DayPlan, Window } from '../types';
import { EXERCISE_COLOR, SLOT_LABELS } from '../types';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Late one';
}

function minutesFor(items: Window['items'], moves: Record<Exercise, Movement>): number {
  const secs = items.reduce((a, it) => a + it.reps * moves[it.exercise].secPerRep, 0);
  // Plus a short rest between sets.
  return Math.max(1, Math.round((secs + Math.max(0, items.length - 1) * 45) / 60));
}

/** Whether the check-in card is due: from the day after onboarding, until
 * it's answered, and not on a day it was waved off. */
function checkInDue(p: Profile, today: string): boolean {
  if (p.checkInDoneAt) return false;
  if (p.checkInSnoozedOn === today) return false;
  return localDate(new Date(p.createdAt)) < today;
}

/**
 * Home. One question answered at a glance - "what do I do next?" - and one
 * button to do it.
 *
 * Everything the day needs sits in a single card: the ring for how far along
 * you are, the three moves (tap to swap), the next set and its Start button,
 * and a strip of the day's sets. Anything else - the check-in, a retest
 * nudge, install - gets at most one card below it, never a stack.
 */
export default function Today() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [done, setDone] = useState<Record<Exercise, number>>({ push: 0, pull: 0, squat: 0 });
  const [streak, setStreak] = useState(0);
  const [picking, setPicking] = useState<Exercise | null>(null);
  const [shared, setShared] = useState(false);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const p = await getProfile();
    if (!p || isCancelled()) return;
    setProfile(p);
    const today = localDate();
    let dp = await generateDayPlan(today, dayIndexFor(p.createdAt, today), p);
    dp = await reflowMissedWindows(dp, today, p.maxes);
    if (isCancelled()) return;
    setPlan(dp);
    const logs = await getSetLogs(today);
    const completed: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
    for (const log of logs) completed[log.exercise] += log.reps;
    const s = await getStreak();
    if (isCancelled()) return;
    setDone(completed);
    setStreak(s.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => void load(() => cancelled);
    run();
    const id = setInterval(run, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  if (!profile || !plan) return null;

  const today = localDate();
  const moves: Record<Exercise, Movement> = {
    push: movementFor(profile, 'push'),
    pull: movementFor(profile, 'pull'),
    squat: movementFor(profile, 'squat'),
  };

  const totalDone = EXERCISES.reduce((a, ex) => a + done[ex], 0);
  const dailyGoal: number = plan.tier ?? EXERCISES.reduce((a, ex) => a + (plan.targets[ex] ?? 0), 0);
  const totalLeft = Math.max(0, dailyGoal - totalDone);
  const goalHit = totalDone >= dailyGoal;
  const ringColor = goalHit ? 'var(--color-gold)' : 'var(--color-accent)';

  const openWindow = plan.windows.find((w) => w.status === 'pending' || w.status === 'reflowed');
  // With every window gone by there's still work owed, so the earliest
  // unfinished one stands in - there is always something to tap.
  const nextWindow = openWindow ?? plan.windows.find((w) => w.status !== 'done');
  const nextIsMissed = nextWindow?.status === 'missed';
  const surprise = profile.dayStyle === 'surprise';
  const nowMin = nowMinutes();
  // A surprise set's time stays hidden until it arrives. Starting early is
  // still allowed - it just isn't announced.
  const hideTime = (w: Window) => surprise && w.status !== 'done' && timeToMinutes(w.at) > nowMin;

  const sessionUrl = (w: Window) =>
    `/session?windowId=${w.id}&items=${encodeURIComponent(JSON.stringify(w.items))}`;

  const nextParts = nextWindow
    ? summariseItems(nextWindow.items).map(({ exercise, reps }) => ({ exercise, text: repsOf(reps, moves[exercise]) }))
    : [];

  const retestDue = shouldRebaseline(profile.lastRebaselineAt, today, localDate(new Date(profile.createdAt)));

  const coachLine = goalHit
    ? `All ${dailyGoal} banked. Anything more is a bonus.`
    : totalDone === 0
      ? `${dailyGoal} reps today. The first set is the hardest one.`
      : totalLeft > dailyGoal * 0.6
        ? 'Good start. Short sets add up fast.'
        : `${totalLeft} to go. You're past the hump.`;

  const pickMovement = async (slot: Exercise, m: Movement) => {
    const next = { ...profile, variations: { ...profile.variations, [slot]: m.id } };
    setProfile(next);
    setPicking(null);
    await saveProfile(next);
  };

  const snoozeCheckIn = async () => {
    const next = { ...profile, checkInSnoozedOn: today };
    setProfile(next);
    await saveProfile(next);
  };

  const shareDay = async () => {
    const ok = await shareText(
      `Just banked ${totalDone} reps on Rungs${streak > 1 ? `, day ${streak} in a row` : ''}. Short sets, no gym. Join me:`,
    );
    if (ok) { setShared(true); setTimeout(() => setShared(false), 2200); }
  };

  // At most one of these, most useful first.
  const nudge = checkInDue(profile, today)
    ? 'checkin'
    : retestDue
      ? 'retest'
      : 'install';

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col px-5 pt-3.5 pb-28 gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-[23px] font-semibold tracking-[-0.025em] truncate">
            {greeting(new Date().getHours())}{profile.name.trim() ? `, ${profile.name.trim()}` : ''}
          </h1>
          <p className="text-[13px] leading-[1.45] text-neutral-400">{coachLine}</p>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {streak > 0 && (
            <span
              className="h-8 px-2.5 rounded-full flex items-center gap-1 text-[13px] font-semibold tabular-nums"
              style={{ background: 'color-mix(in srgb, var(--color-gold) 14%, transparent)', color: 'var(--color-gold)' }}
              aria-label={`${streak} day streak`}
            >
              <Flame size={14} fill="currentColor" /> {streak}
            </span>
          )}
          <CloudButton />
        </div>
      </header>

      <LitCard className="flex flex-col p-4 gap-4">
        {/* Where the day stands: the ring, and each slot's move and count. */}
        <div className="flex items-center gap-4">
          <ProgressRing size={112} strokeWidth={9} progress={totalDone / dailyGoal} color={ringColor}>
            <div className="flex flex-col items-center">
              <span className="text-[30px] font-semibold tabular-nums leading-none tracking-[-0.03em]" style={{ color: goalHit ? 'var(--color-gold)' : undefined }}>
                {totalDone}
              </span>
              <span className="text-[11px] tabular-nums text-neutral-500 mt-0.5">of {dailyGoal}</span>
            </div>
          </ProgressRing>
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            {EXERCISES.map((ex) => {
              const target = plan.targets[ex] ?? 0;
              const finished = done[ex] >= target && target > 0;
              return (
                <button
                  type="button"
                  key={ex}
                  onClick={() => setPicking(ex)}
                  aria-label={`${SLOT_LABELS[ex]}: ${moves[ex].name}, ${done[ex]} of ${target}. Tap to swap.`}
                  className="flex items-center gap-2 py-1.25 -mx-1.5 px-1.5 rounded-[9px] text-left cursor-pointer hover:bg-text/5 active:bg-text/8 min-w-0"
                >
                  <i className="block w-2 h-2 rounded-full flex-none" style={{ background: EXERCISE_COLOR[ex] }} />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-medium truncate">{moves[ex].name}</span>
                  </span>
                  <span className="text-[12px] tabular-nums flex-none flex items-center gap-1" style={{ color: finished ? 'var(--color-success)' : 'var(--color-neutral-400)' }}>
                    {finished && <Check size={12} strokeWidth={3} />}
                    {done[ex]}<span className="text-neutral-600">/{target}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-text/8" />

        {/* What's next, and the one button on this screen that matters. */}
        {nextWindow && !goalHit ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] tracking-[0.12em]" style={{ color: nextIsMissed ? 'var(--color-gold)' : 'var(--color-accent)' }}>
                {nextIsMissed ? `CATCH UP · ${nextWindow.at}` : hideTime(nextWindow) ? 'NEXT SET · IT’S A SURPRISE' : `UP NEXT · ${nextWindow.at}`}
              </span>
              {/* One move per line keeps long names ("3 band-assisted pull-ups")
                  from running off the card, and reads like a checklist. */}
              <span className="flex flex-col gap-0.5 text-[16.5px] leading-[1.35] font-medium tracking-[-0.01em]">
                {nextParts.map((p) => (
                  <span key={p.exercise} className="flex items-center gap-2 min-w-0">
                    <i className="block w-1.5 h-1.5 rounded-full flex-none" style={{ background: EXERCISE_COLOR[p.exercise] }} />
                    <span className="truncate">{p.text}</span>
                  </span>
                ))}
              </span>
            </div>
            <Button variant="solid" block className="h-12 text-[15px] rounded-[13px]" onClick={() => navigate(sessionUrl(nextWindow))}>
              <Play size={15} fill="currentColor" /> Start · about {minutesFor(nextWindow.items, moves)} min
            </Button>
          </div>
        ) : goalHit ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 flex flex-col gap-0.5">
              <span className="text-[15px] font-medium flex items-center gap-1.5"><Sparkles size={15} style={{ color: 'var(--color-gold)' }} /> Day complete</span>
              <span className="text-[12px] text-neutral-500">Tell someone. It's how squads start.</span>
            </span>
            <Button variant="primary" className="h-10 px-4 text-[13px] flex-none" onClick={() => void shareDay()}>
              {shared ? <><Check size={14} /> Copied</> : <><Share2 size={14} /> Share</>}
            </Button>
          </div>
        ) : (
          <div className="text-[14px] text-neutral-400">Today's sets have passed. Tap + to log reps any time.</div>
        )}

        {/* The day at a glance. Every unfinished set can be started from here. */}
        {plan.windows.length > 1 && (
          <div className="flex gap-1.5" aria-label="Today's sets">
            {plan.windows.map((w) => {
              const isDone = w.status === 'done';
              const isNext = w === nextWindow && !goalHit;
              const missed = w.status === 'missed';
              return (
                <button
                  type="button"
                  key={w.id}
                  disabled={isDone}
                  onClick={() => navigate(sessionUrl(w))}
                  className="flex-1 min-w-0 h-9 rounded-[10px] flex items-center justify-center gap-1 text-[11.5px] tabular-nums cursor-pointer disabled:cursor-default transition-colors"
                  style={{
                    background: isDone ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                      : isNext ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                        : 'color-mix(in srgb, var(--color-text) 5%, transparent)',
                    color: isDone ? 'var(--color-success)' : isNext ? 'var(--color-accent-200)' : missed ? 'var(--color-gold)' : 'var(--color-neutral-500)',
                    boxShadow: isNext ? 'inset 0 0 0 1px var(--color-accent-600)' : undefined,
                  }}
                >
                  {isDone && <Check size={12} strokeWidth={3} />}
                  {hideTime(w) ? '?' : w.at}
                </button>
              );
            })}
          </div>
        )}
      </LitCard>

      {nudge === 'checkin' && (
        <div className="relative flex items-center gap-3 p-3.5 pr-11 rounded-[15px] bg-accent-900">
          <button type="button" onClick={() => navigate('/checkin')} className="flex-1 flex flex-col gap-0.5 text-left cursor-pointer">
            <span className="text-[13.5px] font-medium text-accent-100">Day two. Make it fit you better</span>
            <span className="text-[12px] leading-[1.4] text-accent-200">
              30 seconds: your name, your weight for calorie estimates{profile.maxesEstimated ? ', and your real numbers' : ''}.
            </span>
          </button>
          <button
            type="button"
            aria-label="Not now"
            onClick={() => void snoozeCheckIn()}
            className="absolute top-2 right-2 w-8 h-8 grid place-items-center rounded-full text-accent-200 hover:bg-text/8 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {nudge === 'retest' && (
        <button
          type="button"
          onClick={() => navigate('/settings/retest')}
          className="flex items-center gap-3 p-3.5 rounded-[15px] bg-accent-900 text-left cursor-pointer"
        >
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-accent-100">Three weeks in. Stronger?</span>
            <span className="text-[12px] leading-[1.4] text-accent-200">Retest so your sets keep up with you.</span>
          </span>
          <span className="text-[13px] text-accent-200 flex-none">›</span>
        </button>
      )}

      {nudge === 'install' && <InstallCard />}

      <SquadCard myReps={totalDone} />

      {picking && (
        <MovementPicker
          slot={picking}
          equipment={equipmentOf(profile)}
          currentId={moves[picking].id}
          note="Reps count the same whichever move you pick."
          onPick={(m) => void pickMovement(picking, m)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
