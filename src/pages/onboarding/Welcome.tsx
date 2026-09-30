import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Button from '../../components/Button';
import { tint } from '../../theme';
import { EXERCISE_REFERENCE } from '../../data/exerciseReference';
import { cloudConfigured } from '../../cloud/config';
import type { Exercise } from '../../types';

const HERO_CYCLE: Exercise[] = ['push', 'pull', 'squat'];
const HERO_WORDS: Record<Exercise, string> = { push: 'Push.', pull: 'Pull.', squat: 'Legs.' };
const HERO_INTERVAL_MS = 3800;

/** The first screen, and for most people the only pitch they read. It has one
 * job - get a tap on "Get started" - so it says three things: what it is
 * (short sets through the day), that it fits you (your moves, your level),
 * and that it costs nothing to try. */
export default function Welcome() {
  const navigate = useNavigate();
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setHeroIndex((i) => (i + 1) % HERO_CYCLE.length), HERO_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="route-forward relative h-full overflow-hidden flex flex-col">
      {/* Full-bleed footage behind everything, faded into the ground so the
          copy stays readable in every theme. */}
      <div
        className="absolute inset-0"
        // Shown until (or instead of, where the codec isn't there) the footage.
        style={{ background: `radial-gradient(90% 55% at 70% 30%, ${tint('var(--color-accent)', 30)}, transparent 70%), radial-gradient(70% 45% at 15% 55%, ${tint('var(--color-accent-700)', 35)}, transparent 70%)` }}
      >
        {HERO_CYCLE.map((ex, i) => (
          <video
            key={ex}
            src={EXERCISE_REFERENCE[ex].video}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-out"
            style={{ opacity: i === heroIndex ? 1 : 0 }}
          />
        ))}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, ${tint('var(--color-bg)', 55)} 0%, ${tint('var(--color-bg)', 20)} 30%, ${tint('var(--color-bg)', 70)} 58%, var(--color-bg) 78%)` }}
        />
      </div>

      <div className="relative flex-1 flex flex-col px-6.5 pt-8 pb-action">
        <div className="text-[11px] tracking-[0.24em] text-accent font-semibold">RUNGS</div>

        <div className="flex gap-2 mt-3" aria-hidden>
          {HERO_CYCLE.map((ex, i) => (
            <span
              key={ex}
              className="text-[13px] font-medium tracking-[0.02em] transition-colors duration-500"
              style={{ color: i === heroIndex ? 'var(--color-text)' : 'var(--color-neutral-600)' }}
            >
              {HERO_WORDS[ex]}
            </span>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <h1 className="text-[40px] leading-[1.02] font-semibold tracking-[-0.035em]" style={{ textWrap: 'balance' }}>
            Get strong,<br />a few minutes<br />at a time.
          </h1>
          <p className="text-[14.5px] leading-[1.55] text-neutral-300 max-w-[320px]">
            A hundred reps a day, cut into short sets you fit around your life.
            Your level, your moves, no gym. Bring your friends.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 mt-7">
          <Button variant="solid" block className="h-13 text-[16px] rounded-[14px]" onClick={() => navigate('/onboarding/level')}>
            Get started <ArrowRight size={17} />
          </Button>
          {cloudConfigured && (
            <button
              type="button"
              onClick={() => navigate('/settings/sync', { state: { from: 'welcome' } })}
              className="text-[13px] text-neutral-400 hover:text-text py-2 cursor-pointer"
            >
              I have an account · <span className="text-accent-300">Sign in</span>
            </button>
          )}
          <div className="flex justify-center gap-3 text-[11px] text-neutral-500 pt-0.5">
            <span>Free forever</span><span aria-hidden>·</span>
            <span>No sign-up</span><span aria-hidden>·</span>
            <span>Under a minute to start</span>
          </div>
        </div>
      </div>
    </div>
  );
}
