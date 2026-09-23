import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, Mic, MicOff, Minus, Pause, Play, PlayCircle, Plus } from 'lucide-react';
import Button from '../components/Button';
import TempoSlider from '../components/TempoSlider';
import ModeChip from '../components/ModeChip';
import IconChip from '../components/IconChip';
import Sheet from '../components/Sheet';
import { tint } from '../theme';
import { useCadenceEngine } from '../hooks/useCadenceEngine';
import { getSettings, saveSetLog, getDayPlan, saveDayPlan, saveBaselineLog, getSetLogs } from '../db';
import { recordDayProgress } from '../engine/planGenerator';
import { localDate, localTime } from '../engine/dates';
import { EXERCISE_REFERENCE } from '../data/exerciseReference';
import type { CounterMode, Exercise, CounterVariant, WindowItem } from '../types';
import { EXERCISE_LABELS, EXERCISE_ICON, EXERCISE_COLOR, EXERCISE_CHIP_BG, EXERCISE_TINT_BG, TEMPO_RANGE } from '../types';
import { requestWakeLock, releaseWakeLock, primeSpeech, stopSpeech } from '../engine/audio';

const RING_R = 112;
const RING_DASH = 2 * Math.PI * RING_R; // 703.7
const REST_SECONDS = 45;

const MODE_OPTIONS: { key: CounterMode; label: string }[] = [
  { key: 'voice', label: 'Voice-led' },
  { key: 'tap', label: 'Manual' },
];

interface SessionState {
  count: number;
  target: number;
}

function parseQueue(params: URLSearchParams): WindowItem[] {
  const raw = params.get('items');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WindowItem[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to single-item parsing
    }
  }
  const exercise = (params.get('exercise') as Exercise) || 'push';
  const target = Number(params.get('target') || 12);
  return [{ exercise, reps: target }];
}

export default function Session() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const isBaseline = params.get('mode') === 'baseline';
  // A max test can be run from onboarding or from a later retest; it has to
  // return to whichever one sent us here.
  const baselineReturn = params.get('from') === 'retest' ? '/settings/retest' : '/onboarding/baseline';
  const isAdhoc = params.get('adhoc') === '1';
  const windowId = params.get('windowId') ?? undefined;

  const queue = useMemo(() => parseQueue(params), [params]);
  const [itemIndex, setItemIndex] = useState(0);
  const item = queue[itemIndex];
  const exercise = item.exercise;
  const target = isBaseline || isAdhoc ? Infinity : item.reps;
  const exColor = EXERCISE_COLOR[exercise];

  const [mode, setMode] = useState<CounterMode>('voice');
  const [counterVariant, setCounterVariant] = useState<CounterVariant>('cadenceRing');
  const [voiceOn, setVoiceOn] = useState(true);
  const [ticksOn, setTicksOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [done, setDone] = useState<SessionState | null>(null);
  const [resting, setResting] = useState(false);
  const [restLeft, setRestLeft] = useState(REST_SECONDS);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [ready, setReady] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setCounterVariant(s.counterVariant);
      setVoiceOn(s.voice);
      setTicksOn(s.ticks);
      setHapticsOn(s.haptics);
    });
  }, []);

  useEffect(() => {
    requestWakeLock();
    return () => { releaseWakeLock(); stopSpeech(); };
  }, []);

  /** Starts the 3-2-1 countdown. Also the user gesture that unlocks Android's
   * TTS engine - speech started later off a timer is silently dropped unless
   * the engine was primed from within a real tap. */
  const beginCountdown = () => {
    if (voiceOn && mode === 'voice') primeSpeech();
    setReady(3);
  };

  // `startNextItem` is declared further down (it needs `engine`, which needs
  // `handleBank`), so the rest countdown below reaches the current version
  // through this ref instead of capturing a stale closure.
  const startNextItemRef = useRef<() => void>(() => {});

  // The rest countdown runs off a wall-clock deadline rather than by
  // decrementing once per setTimeout. Android throttles (and, once the screen
  // locks, suspends) timers in a backgrounded WebView, so a tick-based counter
  // silently stretches a 45s rest into minutes while the phone is asleep.
  useEffect(() => {
    if (!resting || restEndsAt === null) return;
    const sync = () => {
      const left = Math.ceil((restEndsAt - Date.now()) / 1000);
      if (left <= 0) {
        startNextItemRef.current();
        return true;
      }
      setRestLeft(left);
      return false;
    };
    if (sync()) return;
    const t = setInterval(() => { if (sync()) clearInterval(t); }, 250);
    // Re-sync the moment the screen comes back, so a rest that expired while
    // the phone was asleep advances immediately instead of on the next tick.
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [resting, restEndsAt]);

  useEffect(() => {
    if (ready === null) return;
    if (ready === 0) {
      const t = setTimeout(() => { setReady(null); engine.toggleRun(); }, 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setReady((n) => (n ?? 1) - 1), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const hasNextItem = itemIndex < queue.length - 1;

  const handleBank = (reps: number) => {
    const today = localDate();
    if (isBaseline) {
      saveBaselineLog({ id: exercise, exercise, maxReps: reps, testedAt: Date.now() });
      navigate(baselineReturn, { replace: true, state: location.state });
      return;
    }
    const logged = saveSetLog({
      id: `${Date.now()}`,
      date: today,
      at: localTime(),
      exercise,
      reps,
      targetReps: Number.isFinite(target) ? target : reps,
      tempo: engine.state.tempo,
      mode,
      windowId,
      source: isAdhoc ? 'manual' : 'session',
      completedAt: Date.now(),
    });
    logged.then(() => getDayPlan(today)).then(async (plan) => {
      if (!plan) return;
      const window = windowId ? plan.windows.find((w) => w.id === windowId) : undefined;
      if (!hasNextItem && window) {
        // Only close out the window once every item in it actually hit its
        // target - banking a partial set (e.g. 10 of 34 squats) must not
        // check the window off, or it never resurfaces for the shortfall.
        const logs = await getSetLogs(today);
        const bankedForWindow = logs.filter((l) => l.windowId === windowId);
        const metTarget = window.items.every((wi) => {
          const banked = bankedForWindow
            .filter((l) => l.exercise === wi.exercise)
            .reduce((sum, l) => sum + l.reps, 0);
          return banked >= wi.reps;
        });
        if (metTarget) {
          const updated = { ...plan, windows: plan.windows.map((w) => (w.id === windowId ? { ...w, status: 'done' as const } : w)) };
          await saveDayPlan(updated);
          await recordDayProgress(updated);
          return;
        }
      }
      await recordDayProgress(plan);
    });

    if (hasNextItem) {
      setResting(true);
      setRestLeft(REST_SECONDS);
      setRestEndsAt(Date.now() + REST_SECONDS * 1000);
      return;
    }
    setDone({ count: reps, target: Number.isFinite(target) ? target : reps });
  };

  const engine = useCadenceEngine({
    target,
    mode,
    initialTempo: TEMPO_RANGE[exercise].default,
    voiceEnabled: voiceOn && mode === 'voice',
    // Ticks are the cadence metronome - they only make sense in voice-led mode,
    // where the app is setting the pace. In manual mode the user sets their own
    // pace by tapping, so a timed tick would just be noise.
    ticksEnabled: ticksOn && mode === 'voice',
    hapticsEnabled: hapticsOn,
    onBank: handleBank,
  });

  const goToItem = (index: number) => {
    setResting(false);
    setRestLeft(REST_SECONDS);
    setRestEndsAt(null);
    setItemIndex(index);
    engine.reset(TEMPO_RANGE[queue[index].exercise].default);
  };

  const startNextItem = () => goToItem(itemIndex + 1);
  startNextItemRef.current = startNextItem;

  /** Moves past an exercise without banking it - for the pull-up set you can't
   * do because there's no bar where you are.
   *
   * Nothing is logged and the window is never marked done, so the set stays
   * outstanding and can be picked up again from Today rather than being
   * written off. `from` is the item being skipped: the current one from the
   * session screen, the one being rested for from the rest screen. */
  const skipItem = (from: number) => {
    stopSpeech();
    engine.stop();
    if (from + 1 <= queue.length - 1) {
      goToItem(from + 1);
    } else {
      navigate('/today');
    }
  };

  const cue = engine.state.running
    ? (engine.state.phase === 'down' ? 'DOWN' : 'UP')
    : (engine.state.count > 0 ? 'PAUSED' : 'READY');
  const cueColor = engine.state.running
    ? (engine.state.phase === 'down' ? exColor : 'var(--color-text)')
    : 'var(--color-neutral-600)';

  const offset = useMemo(() => {
    if (!Number.isFinite(target) || target === 0) return RING_DASH;
    return RING_DASH * (1 - Math.min(1, engine.state.count / target));
  }, [engine.state.count, target]);

  const tempoRange = TEMPO_RANGE[exercise];
  const formRef = EXERCISE_REFERENCE[exercise];

  const showLanding = !engine.state.running && !ready && !resting && !done;

  if (resting) {
    const nextItem = queue[itemIndex + 1];
    const nextColor = EXERCISE_COLOR[nextItem.exercise];
    return (
      <div className="route-done flex-1 h-full flex flex-col items-center justify-center px-6 py-6.5 gap-4 text-center">
        <div className="text-[13px] tracking-[0.14em] text-accent">REST</div>
        <div className="text-[64px] font-medium tabular-nums leading-none">{restLeft}</div>
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[13px]"
          style={{ background: EXERCISE_TINT_BG[nextItem.exercise] }}
        >
          <IconChip exercise={nextItem.exercise} size={30}>{EXERCISE_ICON[nextItem.exercise]}</IconChip>
          <span className="text-[13.5px] leading-[1.4] text-left" style={{ color: nextColor }}>
            Next up<br />
            <span className="text-text font-medium">{nextItem.reps} {EXERCISE_LABELS[nextItem.exercise].toLowerCase()}</span>
          </span>
        </div>
        <div className="w-full flex flex-col gap-2.25 mt-1">
          <Button variant="primary" block className="h-12 text-[15px]" onClick={startNextItem}>
            Skip rest, start now
          </Button>
          <button
            type="button"
            onClick={() => skipItem(itemIndex + 1)}
            className="h-8 text-[12.5px] text-neutral-500 cursor-pointer"
          >
            Skip {EXERCISE_LABELS[nextItem.exercise].toLowerCase()}
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="route-done flex-1 h-full flex flex-col items-center justify-center px-6 py-6.5 gap-4 text-center">
        <div
          className="w-[104px] h-[104px] rounded-full grid place-items-center"
          style={{ background: 'var(--color-accent-900)', boxShadow: `0 0 0 12px ${tint('var(--color-accent)', 8)}` }}
        >
          <Check size={46} strokeWidth={2.5} className="text-accent" aria-hidden />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[28px] font-medium tracking-[-0.02em]">{done.count} reps banked</div>
          <div className="text-[13.5px] leading-[1.5] text-neutral-400 max-w-[280px]">
            Nice work. That's banked into today's totals.
          </div>
        </div>
        <div className="w-full flex flex-col gap-2.25 mt-1">
          <Button variant="primary" block className="h-12 text-[15px]" onClick={() => navigate('/today')}>
            Back to today
          </Button>
          <Button variant="secondary" block className="h-11" onClick={() => { setDone(null); engine.reset(); }}>
            One more set
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="route-session relative flex-1 h-full flex flex-col px-5 pt-3 pb-5.5 gap-3"
      style={{ background: `radial-gradient(120% 60% at 50% 8%, ${EXERCISE_TINT_BG[exercise]}, var(--color-bg) 70%)` }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <Button variant="icon" aria-label="Back" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <div className="flex items-center gap-2">
          <IconChip exercise={exercise} size={26}>{EXERCISE_ICON[exercise]}</IconChip>
          <div className="flex flex-col items-start gap-px">
            <span className="text-[14.5px] font-medium">{EXERCISE_LABELS[exercise]}</span>
            <span
              className="text-[10.5px] font-medium px-1.5 py-px rounded-[5px] -ml-1.5"
              style={{ background: EXERCISE_CHIP_BG[exercise], color: exColor }}
            >
              {isBaseline
                ? 'Baseline test'
                : isAdhoc
                  ? 'Logged separately'
                  : queue.length > 1
                    ? `${itemIndex + 1} of ${queue.length} · target ${target}`
                    : `Target ${target}`}
            </span>
          </div>
        </div>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            aria-label={`How to do ${EXERCISE_LABELS[exercise].toLowerCase()}`}
            className="w-9 h-9 rounded-[10px] grid place-items-center cursor-pointer bg-text/7 text-neutral-500"
          >
            <PlayCircle size={16} />
          </button>
          <button
            type="button"
            onClick={() => setVoiceOn((v) => !v)}
            aria-label="Voice count"
            aria-pressed={voiceOn}
            className={`w-9 h-9 rounded-[10px] grid place-items-center cursor-pointer transition-colors ${
              voiceOn ? 'bg-accent-800 text-accent-300' : 'bg-text/7 text-neutral-500'
            }`}
          >
            {voiceOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-3.5 min-h-[280px] relative">
        {showLanding && (
          <div className="absolute inset-0 z-10 rounded-[18px] overflow-hidden flex flex-col">
            <video
              key={formRef.video}
              src={formRef.video}
              muted
              loop
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(180deg, ${tint('var(--color-bg)', 35)} 0%, ${tint('var(--color-bg)', 55)} 55%, var(--color-bg) 96%)` }}
            />
            <div className="relative flex-1 flex flex-col items-center justify-end gap-3 px-6 pb-6 text-center">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium tracking-[0.06em]"
                style={{ background: tint('var(--color-bg)', 60), color: exColor, boxShadow: `inset 0 0 0 1px ${tint(exColor, 33)}` }}
              >
                <span className="text-[13px] leading-none">{EXERCISE_ICON[exercise]}</span>
                {EXERCISE_LABELS[exercise].toUpperCase()}
              </div>
              <div className="text-[26px] font-medium tracking-[-0.02em]">
                {engine.state.count > 0
                  ? `Paused at ${engine.state.count}`
                  : isBaseline
                    ? 'Ready to test'
                    : isAdhoc
                      ? 'Ready when you are'
                      : `${target} reps to go`}
              </div>
              <Button
                variant="primary"
                className="h-13 px-8 text-[15px] !rounded-full"
                style={{ borderColor: exColor, color: exColor }}
                onClick={beginCountdown}
              >
                <Play size={15} fill="currentColor" aria-hidden />
                {engine.state.count > 0 ? 'Resume' : 'Start'}
              </Button>
            </div>
          </div>
        )}

        {ready !== null && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-[18px] overflow-hidden" style={{ background: tint('var(--color-bg)', 92) }}>
            <div className="text-[96px] font-medium tabular-nums leading-none" style={{ color: exColor }}>
              {ready > 0 ? ready : 'GO'}
            </div>
          </div>
        )}

        {!showLanding && counterVariant === 'bigNumeral' && (
          <button type="button" aria-label="Count a rep" onClick={engine.tapRep} className="flex flex-col items-center gap-0.5 cursor-pointer select-none">
            <div className="text-[132px] leading-[.9] font-medium tracking-[-0.05em] tabular-nums">{engine.state.count}</div>
            <div className="text-xs tracking-[0.28em] text-neutral-500">REPS</div>
            <div
              className="mt-3 px-4 py-1.5 rounded-full text-[20px] font-semibold tracking-[0.08em]"
              style={{ color: cueColor, background: engine.state.running ? EXERCISE_TINT_BG[exercise] : 'transparent' }}
            >
              {cue}
            </div>
          </button>
        )}

        {!showLanding && counterVariant === 'cadenceRing' && (
          <button type="button" aria-label="Count a rep" onClick={engine.tapRep} className="relative w-[250px] h-[250px] rounded-full cursor-pointer select-none grid place-items-center">
            <div
              className="absolute inset-[18px] rounded-full"
              style={{ background: `radial-gradient(circle, ${tint(exColor, 20)}, transparent 70%)`, animation: `hpulse ${engine.state.tempo}s ease-in-out infinite` }}
            />
            <svg viewBox="0 0 250 250" className="absolute inset-0 w-[250px] h-[250px] -rotate-90">
              <circle cx="125" cy="125" r={RING_R} fill="none" stroke="color-mix(in srgb, var(--color-text) 9%, transparent)" strokeWidth="10" />
              <circle
                cx="125" cy="125" r={RING_R} fill="none" stroke={exColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={RING_DASH} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset .3s' }}
              />
            </svg>
            <div className="flex flex-col items-center gap-0.5 z-10">
              <div className="text-[82px] leading-[.95] font-medium tracking-[-0.04em] tabular-nums">{engine.state.count}</div>
              <div className="text-[11px] tracking-[0.2em] text-neutral-500">OF {Number.isFinite(target) ? target : '—'}</div>
              <div
                className="mt-2.5 px-3.5 py-1.5 rounded-full text-[15px] font-semibold tracking-[0.08em]"
                style={{ color: cueColor, background: engine.state.running ? EXERCISE_TINT_BG[exercise] : 'transparent' }}
              >
                {cue}
              </div>
            </div>
          </button>
        )}

        {!showLanding && counterVariant === 'ladderLane' && (
          <button type="button" aria-label="Count a rep" onClick={engine.tapRep} className="flex items-center gap-5 cursor-pointer select-none text-left">
            <div className="flex flex-col-reverse gap-1 h-[300px] justify-start">
              {Array.from({ length: 12 }, (_, i) => {
                const h = 8 + Math.round(6 * Math.sin(i / 2));
                const lit = i < engine.state.count;
                return <span key={i} style={{ height: h, background: lit ? exColor : 'color-mix(in srgb, var(--color-text) 10%, transparent)' }} className="w-[52px] rounded block transition-colors" />;
              })}
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[70px] leading-[.95] font-medium tracking-[-0.04em] tabular-nums">{engine.state.count}</div>
              <div className="text-[11px] tracking-[0.2em] text-neutral-500">OF {Number.isFinite(target) ? target : '—'} REPS</div>
              <div
                className="mt-2.5 px-3.5 py-1.5 rounded-full text-[15px] font-semibold tracking-[0.08em]"
                style={{ color: cueColor, background: engine.state.running ? EXERCISE_TINT_BG[exercise] : 'transparent' }}
              >
                {cue}
              </div>
            </div>
          </button>
        )}
      </div>

      <TempoSlider tempo={engine.state.tempo} onChange={engine.setTempo} min={tempoRange.min} max={tempoRange.max} />

      <div className="flex items-center justify-center gap-4">
        <Button variant="secondary" aria-label="One rep fewer" onClick={engine.decRep} className="!w-13 !h-13 !p-0 rounded-full"><Minus size={20} /></Button>
        <Button
          variant="primary"
          onClick={() => { if (!engine.state.running) beginCountdown(); else engine.toggleRun(); }}
          aria-label={engine.state.running ? 'Pause' : 'Start'}
          className="!w-[78px] !h-[78px] !p-0 rounded-full"
          style={{ borderColor: exColor, color: exColor }}
        >
          {engine.state.running
            ? <Pause size={28} fill="currentColor" strokeWidth={0} />
            : <Play size={28} fill="currentColor" strokeWidth={0} className="ml-1" />}
        </Button>
        <Button variant="secondary" aria-label="One more rep" onClick={engine.tapRep} className="!w-13 !h-13 !p-0 rounded-full"><Plus size={20} /></Button>
      </div>

      <ModeChip options={MODE_OPTIONS} value={mode} onChange={setMode} />
      <Button variant="ghost" block className="h-9.5" onClick={engine.endSet}>
        {isBaseline ? 'End test' : `End set, bank ${engine.state.count} reps`}
      </Button>
      {/* A max test decides the whole plan, so that one isn't skippable. */}
      {!isBaseline && (
        <button
          type="button"
          onClick={() => skipItem(itemIndex)}
          className="h-8 text-[12.5px] text-neutral-500 cursor-pointer"
        >
          {hasNextItem ? 'Skip this exercise →' : 'Skip this set'}
        </button>
      )}

      {showForm && (
        <Sheet title={`${formRef.name} form`} onClose={() => setShowForm(false)} maxHeight="80%">
            <video
              key={formRef.video}
              src={formRef.video}
              controls
              loop
              playsInline
              autoPlay
              className="w-full rounded-[12px] bg-black"
              style={{ maxHeight: 260 }}
            />
            <ol className="flex flex-col gap-1.75 text-[13px] leading-[1.5] text-neutral-300 list-decimal list-inside">
              {formRef.instructions.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <a href={formRef.source} target="_blank" rel="noreferrer" className="text-[11px] text-neutral-500 underline">
              Instructions: {formRef.sourceLabel}
            </a>
        </Sheet>
      )}
    </div>
  );
}
