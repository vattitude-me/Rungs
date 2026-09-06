import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Button from '../../components/Button';
import Radio from '../../components/Radio';
import { getBaselineLogs } from '../../db';
import type { BarAccess, PullRung, RowEquipment } from '../../types';
import { PULL_RUNG_LABELS, PULL_RUNG_HINTS, ROW_EQUIPMENT_LABELS } from '../../types';

const BAR_OPTIONS: { key: BarAccess; name: string; sub: string }[] = [
  { key: 'doorway', name: 'Doorway or wall bar', sub: 'Full pull-up path available' },
  { key: 'park', name: 'Park or gym bar', sub: 'Full path, plus dips later' },
  { key: 'none', name: 'No bar yet', sub: "Rows instead, we'll adapt" },
];

const ROW_OPTIONS: RowEquipment[] = ['table', 'dumbbell', 'kettlebell', 'band'];
const RUNGS: PullRung[] = [0, 1, 2, 3, 4];

/** Suggests a starting rung from the baseline pull-up max. Without a bar you
 * can only row, so that pins to rung 0 regardless of the number. */
function suggestRung(pullMax: number, bar: BarAccess): PullRung {
  if (bar === 'none') return 0;
  if (pullMax >= 8) return 4;
  if (pullMax >= 3) return 3;
  if (pullMax >= 1) return 2;
  return 1;
}

export default function Equipment() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { name?: string } | null) ?? {};

  const [bar, setBar] = useState<BarAccess>('doorway');
  const [rung, setRung] = useState<PullRung>(2);
  const [rowEquipment, setRowEquipment] = useState<RowEquipment>('table');
  // Once the user picks a rung by hand we stop overriding it from the bar choice.
  const [rungTouched, setRungTouched] = useState(false);
  const [pullMax, setPullMax] = useState(0);

  useEffect(() => {
    getBaselineLogs().then((logs) => {
      const pull = logs.filter((l) => l.exercise === 'pull').at(-1);
      const max = pull?.maxReps ?? 0;
      setPullMax(max);
      setRung(suggestRung(max, 'doorway'));
    });
  }, []);

  const pickBar = (next: BarAccess) => {
    setBar(next);
    // No bar means rows are the only option; re-suggest unless hand-picked.
    if (next === 'none') { setRung(0); setRungTouched(false); }
    else if (!rungTouched) setRung(suggestRung(pullMax, next));
  };

  const showRowEquipment = rung === 0 || bar === 'none';

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4">
      <div className="flex items-center gap-3">
        <Button
          variant="icon"
          onClick={() => navigate('/onboarding/baseline', { state: navState })}
        >
          <ChevronLeft size={18} />
        </Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '75%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">3 of 4</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[27px] font-medium tracking-[-0.02em]">Do you have a bar?</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          This only changes the pull-up half. Everything else is floor and gravity.
        </div>
      </div>

      <div className="flex flex-col gap-2.25">
        {BAR_OPTIONS.map((opt) => (
          <Radio
            key={opt.key}
            selected={bar === opt.key}
            onSelect={() => pickBar(opt.key)}
            title={opt.name}
            subtitle={opt.sub}
          />
        ))}
      </div>

      <div
        className="p-4 rounded-[14px] shadow-sm flex flex-col gap-3"
        style={{ background: 'linear-gradient(150deg, #1d2033, #161826)' }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] tracking-[0.12em] text-accent">YOUR PULL-UP PATH</span>
          <span className="text-[10px] text-neutral-500">Tap where you're at</span>
        </div>

        <div className="flex items-start gap-1.5">
          {RUNGS.map((r) => {
            const reached = r <= rung;
            const active = r === rung;
            const disabled = bar === 'none' && r > 0;
            return (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() => { setRung(r); setRungTouched(true); }}
                className="flex-1 flex flex-col gap-1.25 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="h-1.5 rounded-full block transition-colors"
                  style={{ background: reached ? '#9184d9' : 'rgba(233,233,237,.14)' }}
                />
                <span
                  className="text-[9.5px] leading-[1.25] transition-colors"
                  style={{ color: active ? '#d2cefd' : '#75798c', fontWeight: active ? 600 : 400 }}
                >
                  {PULL_RUNG_LABELS[r]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-xs leading-[1.5] text-neutral-400">
          You're on <strong className="text-text font-medium">{PULL_RUNG_LABELS[rung].toLowerCase()}</strong>:{' '}
          {PULL_RUNG_HINTS[rung]}. Clear 8 clean reps in a set and the coach moves you up a rung.
        </div>

        {bar === 'none' && (
          <div className="text-[11px] leading-[1.5] text-neutral-500">
            Without a bar you'll build the pull with rows. Add a bar later and the
            rest of the path unlocks.
          </div>
        )}
      </div>

      {showRowEquipment && (
        <div className="flex flex-col gap-2.25">
          <div className="text-[11px] tracking-[0.1em] text-neutral-500">WHAT DO YOU ROW WITH?</div>
          <div className="grid grid-cols-2 gap-2">
            {ROW_OPTIONS.map((opt) => {
              const active = rowEquipment === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRowEquipment(opt)}
                  className="px-3.25 py-3 rounded-[13px] text-left text-[12.5px] leading-[1.3] cursor-pointer transition-colors border"
                  style={{
                    background: active ? 'var(--color-accent-900)' : 'var(--color-surface)',
                    borderColor: active ? '#9184d9' : 'transparent',
                    color: active ? '#d2cefd' : '#e9e9ed',
                  }}
                >
                  {ROW_EQUIPMENT_LABELS[opt]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto">
        <Button
          variant="primary" block className="h-12 text-[15px]"
          onClick={() => navigate('/onboarding/schedule', {
            state: {
              ...navState,
              barAccess: bar,
              pullRung: rung,
              rowEquipment: showRowEquipment ? rowEquipment : undefined,
            },
          })}
        >
          Next: pick my windows
        </Button>
      </div>
    </div>
  );
}
