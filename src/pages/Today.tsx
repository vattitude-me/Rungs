import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import ProgressRing from '../components/ProgressRing';
import FillBar from '../components/FillBar';
import LitCard from '../components/LitCard';
import Button from '../components/Button';
import { TimelineRow, type TimelineDotState } from '../components/Timeline';
import CloudButton from '../components/CloudButton';
import InstallCard from '../components/InstallCard';
import SquadCard from '../components/SquadCard';
import { getProfile, getSettings, getSetLogs } from '../db';
import { generateDayPlan, reflowMissedWindows } from '../engine/planGenerator';
import { localDate, dayIndexFor } from '../engine/dates';
import { shouldRebaseline, summariseItems } from '../engine/coach';
import type { Exercise, Profile, DayPlan, DashboardVariant, WindowItem } from '../types';
import { EXERCISE_LABELS, EXERCISE_COLOR } from '../types';

/** Rough seconds per rep, used only for the "about N min" estimate. */
const SECONDS_PER_REP = 4;

function estimateMinutes(reps: number): number {
  return Math.max(1, Math.round((reps * SECONDS_PER_REP) / 60));
}

/** "16 push-ups · 7 pull-ups · 27 squats" - one entry per exercise.
 *
 * The plan stores each set as its own item, so rendering items directly
 * repeated the exercise name once per set. Set counts used to sit inline too
 * ("16 push-ups (2 sets) + ..."), which wrapped the Up next card onto three
 * lines; they now go in the line underneath (see setsLine). */
function summaryParts(items: WindowItem[]): string[] {
  return summariseItems(items).map(({ exercise, reps }) => `${reps} ${EXERCISE_LABELS[exercise].toLowerCase()}`);
}

function compactSummary(items: WindowItem[]): string {
  return summaryParts(items).join(' · ');
}

/** "6 ladder sets" - how the window is split up, under its summary. */
function setsLine(items: WindowItem[], model: DayPlan['model']): string {
  const n = items.length;
  return `${n} ${model === 'ladder' ? 'ladder' : 'straight'} set${n === 1 ? '' : 's'}`;
}

function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Late one';
}

export default function Today() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [dashboardVariant, setDashboardVariant] = useState<DashboardVariant>('rings');
  const [done, setDone] = useState<Record<Exercise, number>>({ push: 0, pull: 0, squat: 0 });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const p = await getProfile();
      if (!p || cancelled) return;
      setProfile(p);
      const settings = await getSettings();
      if (cancelled) return;
      setDashboardVariant(settings.dashboardVariant);

      const today = localDate();
      const dayIndex = dayIndexFor(p.createdAt, today);
      let dp = await generateDayPlan(today, dayIndex, p);
      dp = await reflowMissedWindows(dp, today, p.maxes);
      if (cancelled) return;
      setPlan(dp);

      const logs = await getSetLogs(today);
      const completed: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
      for (const log of logs) completed[log.exercise] += log.reps;
      if (!cancelled) setDone(completed);
    };

    load();
    const id = setInterval(load, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!profile || !plan) return null;

  const rings = (['push', 'pull', 'squat'] as Exercise[]).map((ex) => {
    const target = plan.targets[ex] || 1;
    const d = done[ex];
    const pct = Math.round((100 * d) / target);
    return { key: ex, name: EXERCISE_LABELS[ex], done: d, target: plan.targets[ex], pct, color: EXERCISE_COLOR[ex] };
  });

  const totalDone = rings.reduce((a, r) => a + r.done, 0);
  // The goal is the tier the plan was built for - the sum of its targets.
  const dailyGoal: number = plan.tier ?? rings.reduce((a, r) => a + r.target, 0);
  const totalLeft = Math.max(0, dailyGoal - totalDone);
  const goalHit = totalDone >= dailyGoal;
  const totalPct = Math.round((100 * totalDone) / dailyGoal);
  // Gold at 100%, a brighter accent once past 75% - a visible lift before the finish line.
  const goalBarColor = goalHit ? 'var(--color-gold)' : totalPct >= 75 ? 'var(--color-accent-400)' : 'var(--color-accent-700)';

  const retestDue = shouldRebaseline(
    profile.lastRebaselineAt,
    localDate(),
    localDate(new Date(profile.createdAt))
  );

  const openWindow = plan.windows.find((w) => w.status === 'pending' || w.status === 'reflowed');
  // A window going stale used to end the day's options: once every window had
  // been marked missed there was nothing left to start, even with most of the
  // tier still unbanked. The earliest unfinished window stands in instead, so
  // there is always something to tap while reps are owed.
  const nextWindow = openWindow ?? plan.windows.find((w) => w.status !== 'done');
  const nextIsMissed = Boolean(nextWindow && nextWindow.status === 'missed');
  const nextReps = nextWindow?.items.reduce((a, it) => a + it.reps, 0) ?? 0;
  const nextParts = nextWindow ? summaryParts(nextWindow.items) : [];
  const nextCompact = nextParts.join(' · ');

  const sessionUrl = (w: typeof plan.windows[number]) =>
    `/session?windowId=${w.id}&items=${encodeURIComponent(JSON.stringify(w.items))}`;

  const windowRows = plan.windows.map((w, i) => {
    const state: TimelineDotState =
      w.status === 'done' ? 'done'
        : w === nextWindow ? 'now'
          : w.status === 'missed' ? 'missed'
            : 'later';
    const reps = w.items.reduce((a, it) => a + it.reps, 0);
    const summary = compactSummary(w.items);
    return {
      id: w.id + i, time: w.at, state, window: w,
      // A one-exercise window reads as what it is ("27 squats"); a mixed one
      // as its total, with the mix underneath.
      name: summariseItems(w.items).length > 1 ? `${reps} reps` : summary,
      // The mix is only worth a line when it says something the screen
      // doesn't already: not for a finished window, not for the one the Up
      // next card spells out, and not for one that is the same as it. On a
      // day of identical windows this used to print the same sentence three
      // times.
      sub: state === 'done' || state === 'now' || summariseItems(w.items).length < 2 || summary === nextCompact
        ? null
        : summary,
      // Every window you haven't finished is yours to start, in any order.
      // Only one used to be, so a window that had gone by - or one later in
      // the day you happened to have time for - simply could not be opened.
      actionable: w.status !== 'done',
    };
  });
  const windowsDone = plan.windows.filter((w) => w.status === 'done').length;

  // One line of coaching under the greeting. It used to be a filled banner at
  // the bottom of the screen, below everything it was commenting on.
  const coachLine = goalHit
    ? `Today's ${dailyGoal} is banked. Anything extra is a bonus.`
    : !nextWindow
      ? `No windows left, but you're ${totalLeft} short. Tap + to log the rest.`
      : totalLeft > dailyGoal * 0.6
        ? 'Big day ahead. Twelve reps now beats fifty tonight.'
        : "You're past the hump. The rest is downhill.";

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col px-5 pt-3.5 pb-24 gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[22px] font-medium tracking-[-0.02em]">{greeting(new Date().getHours())}, {profile.name}</div>
          <div className="text-[13px] leading-[1.45] text-neutral-400">{coachLine}</div>
        </div>
        {/* Only sync lives up here now, and only when it needs something -
            the profile button moved into the nav, where it is reachable from
            every tab instead of from Today alone. */}
        <CloudButton />
      </div>

      <InstallCard />

      {retestDue && (
        <button
          type="button"
          onClick={() => navigate('/settings/retest')}
          className="flex items-center gap-3 p-3.25 rounded-[13px] bg-accent-900 text-left cursor-pointer"
        >
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-accent-100">Time to retest your maxes</span>
            <span className="text-[11.5px] leading-[1.4] text-accent-200">
              Your sets are still sized from your last test. A minute now keeps the day honest.
            </span>
          </span>
          <span className="text-[13px] text-accent-200 flex-none">›</span>
        </button>
      )}

      {/* The day's progress, once. The total used to appear three times -
          the subtitle, the goal bar's label and, added up, the rings - across
          four separate cards. */}
      <section aria-label="Today's progress" className="flex flex-col gap-3 p-4 rounded-2xl bg-surface shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[30px] font-medium tabular-nums leading-none tracking-[-0.02em]"
              style={{ color: goalHit ? 'var(--color-gold)' : undefined }}
            >
              {totalDone}
            </span>
            <span className="text-[13px] tabular-nums text-neutral-500">/ {dailyGoal} reps</span>
          </div>
          <span className="text-[11.5px] tabular-nums text-neutral-500">
            {goalHit ? 'Goal hit' : `${totalLeft} to go`} · Day {plan.dayIndex + 1}
          </span>
        </div>
        <FillBar pct={totalPct} color={goalBarColor} height={6} />

        {dashboardVariant === 'rings' ? (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {rings.map((r) => (
              <div key={r.key} className="flex flex-col items-center gap-1.5">
                <ProgressRing size={64} strokeWidth={6} progress={r.pct / 100} color={r.color}>
                  <div className="flex flex-col items-center">
                    <span className="text-[17px] font-medium tabular-nums leading-none">{r.done}</span>
                    <span className="text-[9.5px] tabular-nums text-neutral-600">/ {r.target}</span>
                  </div>
                </ProgressRing>
                <span className="text-[11px] text-neutral-400">{r.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 pt-1">
            {rings.map((r) => (
              <div key={r.key} className="flex flex-col gap-1.25">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] text-neutral-300">{r.name}</span>
                  <span className="text-xs tabular-nums text-neutral-500">{r.done} / {r.target}</span>
                </div>
                <FillBar pct={r.pct} color={r.color} height={7} />
              </div>
            ))}
          </div>
        )}
      </section>

      <LitCard className="flex flex-col gap-2.5 p-4">
        <div className="text-[10px] tracking-[0.12em]" style={{ color: nextIsMissed ? 'var(--color-gold)' : undefined }}>
          <span className={nextIsMissed ? '' : 'text-accent'}>
            {nextWindow
              ? `${nextIsMissed ? 'PICK UP' : 'UP NEXT'} · ${nextWindow.at}`
              : goalHit ? 'ALL WINDOWS DONE' : 'DAY WRAPPED'}
          </span>
        </div>
        {nextWindow ? (
          <>
            {/* Each exercise stays in one piece, so a wrap falls between them
                instead of leaving "push-ups ·" hanging at a line end. */}
            <div className="text-[19px] leading-[1.3] font-medium tracking-[-0.01em]">
              {nextParts.map((part, i) => (
                <span key={part} className="whitespace-nowrap">
                  {i > 0 && <span className="text-neutral-500"> · </span>}
                  {part}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12.5px] text-neutral-400">
                {nextIsMissed ? 'Missed earlier · still yours' : setsLine(nextWindow.items, plan.model)}
                {' '}· about {estimateMinutes(nextReps)} min
              </div>
              <Button
                variant="primary" className="h-11 px-6 text-[14.5px] flex-none"
                onClick={() => navigate(sessionUrl(nextWindow))}
              >
                Start
              </Button>
            </div>
          </>
        ) : goalHit ? (
          <div className="text-[15px] text-neutral-400">Nothing left scheduled today. Nice work.</div>
        ) : (
          <div className="text-[15px] text-neutral-400">Today's windows have passed. Tomorrow's a fresh start.</div>
        )}
      </LitCard>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] tracking-[0.1em] text-neutral-500">TODAY'S WINDOWS</span>
          <span className="text-[11.5px] tabular-nums text-neutral-500">
            {windowsDone} of {plan.windows.length} done
          </span>
        </div>
        <div>
          {windowRows.map((w) => (
            <TimelineRow
              key={w.id}
              time={w.time}
              state={w.state}
              onClick={w.actionable ? () => navigate(sessionUrl(w.window)) : undefined}
            >
              <span className="flex-1 flex flex-col gap-px min-w-0">
                <span className="text-[13.5px] font-medium">{w.name}</span>
                {w.sub && <span className="text-[11px] text-neutral-500">{w.sub}</span>}
              </span>
              <WindowStatus state={w.state} />
            </TimelineRow>
          ))}
        </div>
      </div>

      {/* Below the windows on purpose: the day's plan is what this screen is
          for, and the squad is the reason to go and do it - not a thing to
          scroll past on the way. Renders nothing at all until there are
          friends to show. */}
      <SquadCard myReps={totalDone} />
    </div>
  );
}

/** The right-hand end of a window row. Only a missed window gets colour: the
 * next one already has the lit card and its Start button above, and a bright
 * "Start" on every later row competed with it. */
function WindowStatus({ state }: { state: TimelineDotState }) {
  switch (state) {
    case 'done':
      return (
        <span className="flex items-center gap-1 text-[11.5px] text-neutral-500 flex-none">
          <Check size={13} strokeWidth={2.5} className="text-success" /> Done
        </span>
      );
    case 'now':
      return <span className="text-[11.5px] text-accent-300 flex-none">Up next</span>;
    case 'missed':
      return <span className="text-[11.5px] flex-none" style={{ color: 'var(--color-gold)' }}>Catch up ›</span>;
    case 'later':
      return <ChevronRight size={16} className="text-neutral-600 flex-none" />;
  }
}
