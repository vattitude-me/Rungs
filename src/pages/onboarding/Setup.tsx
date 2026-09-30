import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, Dumbbell, Shuffle, Sun, Waves } from 'lucide-react';
import Button from '../../components/Button';
import StepHeader from '../../components/StepHeader';
import { EQUIPMENT_LABELS } from '../../data/movements';
import { DAY_STYLES, SINGLE_TIMES } from '../../engine/schedule';
import type { DayStyle, Equipment } from '../../types';
import type { OnboardingDraft } from './Level';

export interface SetupDraft extends OnboardingDraft {
  equipment: Equipment[];
  dayStyle: DayStyle;
  singleAt: string;
}

const KIT: Equipment[] = ['bar', 'dumbbell', 'band'];

const STYLE_ICON: Record<DayStyle, typeof Sun> = { spread: Waves, single: Sun, surprise: Shuffle };

/** Step 2: what you have and how you like to train. Both have a sensible
 * answer already selected, so "Build my day" works without touching
 * anything - the choices are there for the people who care. */
export default function Setup() {
  const navigate = useNavigate();
  const location = useLocation();
  const draft = location.state as OnboardingDraft | null;

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [dayStyle, setDayStyle] = useState<DayStyle>('spread');
  const [singleAt, setSingleAt] = useState(SINGLE_TIMES[2].at);

  // Straight here from a reload: the step-one answer is gone, start over.
  if (!draft?.maxes) return <Navigate to="/onboarding/level" replace />;

  const toggle = (e: Equipment) =>
    setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  const next = () => {
    const state: SetupDraft = { ...draft, equipment, dayStyle, singleAt };
    navigate('/onboarding/ready', { state });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-5">
      <StepHeader step={2} of={2} onBack={() => navigate('/onboarding/level')} />

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.025em]">Make it yours</h1>
        <p className="text-[13.5px] leading-[1.5] text-neutral-400">
          Everything works with just your body. Kit only opens up more moves.
        </p>
      </div>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[11px] tracking-[0.1em] text-neutral-500">ANYTHING TO HAND?</h2>
        <div className="flex flex-wrap gap-2">
          {KIT.map((e) => {
            const on = equipment.includes(e);
            return (
              <button
                type="button"
                key={e}
                aria-pressed={on}
                onClick={() => toggle(e)}
                className={[
                  'h-10.5 px-3.5 rounded-full flex items-center gap-1.5 text-[13px] cursor-pointer transition-colors',
                  on ? 'bg-accent/16 text-accent-200 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-surface text-neutral-300 shadow-sm',
                ].join(' ')}
              >
                {on ? <Check size={14} strokeWidth={2.6} /> : e === 'dumbbell' ? <Dumbbell size={14} /> : null}
                {EQUIPMENT_LABELS[e]}
              </button>
            );
          })}
        </div>
        <span className="text-[11.5px] text-neutral-600">
          {equipment.length === 0 ? 'Nothing is fine. A sturdy table counts as a rowing station.' : 'We\'ll mix these in where they fit.'}
        </span>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[11px] tracking-[0.1em] text-neutral-500">HOW DO YOU LIKE IT?</h2>
        <div role="radiogroup" className="flex flex-col gap-2">
          {DAY_STYLES.map((s) => {
            const on = s.id === dayStyle;
            const Icon = STYLE_ICON[s.id];
            return (
              <div key={s.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDayStyle(s.id)}
                  className={[
                    'flex items-center gap-3 px-3.75 py-3.5 rounded-[15px] text-left cursor-pointer transition-all',
                    on ? 'bg-accent/10 shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : 'bg-surface shadow-sm',
                  ].join(' ')}
                >
                  <span
                    className="w-9.5 h-9.5 flex-none rounded-[11px] grid place-items-center transition-colors"
                    style={{ background: on ? 'var(--color-accent)' : 'var(--color-neutral-800)', color: on ? 'var(--color-on-accent)' : 'var(--color-neutral-300)' }}
                  >
                    <Icon size={17} />
                  </span>
                  <span className="flex-1 flex flex-col gap-0.5">
                    <span className="text-[14.5px] font-medium">{s.title}</span>
                    <span className="text-[11.5px] text-neutral-500">{s.sub}</span>
                  </span>
                </button>
                {on && s.id === 'single' && (
                  <div className="flex gap-2 pl-1">
                    {SINGLE_TIMES.map((t) => (
                      <button
                        type="button"
                        key={t.at}
                        aria-pressed={singleAt === t.at}
                        onClick={() => setSingleAt(t.at)}
                        className={[
                          'flex-1 h-10 rounded-[11px] text-[12.5px] cursor-pointer transition-colors',
                          singleAt === t.at ? 'bg-accent/16 text-accent-200 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-text/5 text-neutral-400',
                        ].join(' ')}
                      >
                        {t.label} <span className="tabular-nums text-neutral-500">{t.at}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-auto pt-2">
        <Button variant="solid" block className="h-13 text-[15.5px] rounded-[14px]" onClick={next}>
          Build my day
        </Button>
      </div>
    </div>
  );
}
