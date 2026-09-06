import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import Tag from '../../components/Tag';
import { EXERCISE_REFERENCE } from '../../data/exerciseReference';
import type { Exercise } from '../../types';

const HERO_CYCLE: Exercise[] = ['push', 'pull', 'squat'];
const HERO_INTERVAL_MS = 4500;

export default function Welcome() {
  const navigate = useNavigate();
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setHeroIndex((i) => (i + 1) % HERO_CYCLE.length), HERO_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-6.5 pt-8.5 pb-action">
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] tracking-[0.22em] text-accent font-semibold">RUNGS</div>
        <div className="text-[38px] leading-[1.04] font-medium tracking-[-0.03em]" style={{ textWrap: 'pretty' }}>
          Start at a hundred.<br />Finish at three.
        </div>
        <div className="text-sm leading-[1.55] text-neutral-400 max-w-[300px]">
          100 reps a day to begin: push-ups, pull-ups and squats mixed to your
          strength. Earn your way to 200, then 300: a hundred of each.
        </div>
      </div>

      <div className="flex-1 min-h-9 relative my-6.5 mb-1.5 rounded-2xl overflow-hidden shadow-sm bg-bg">
        {HERO_CYCLE.map((ex, i) => (
          <video
            key={ex}
            src={EXERCISE_REFERENCE[ex].video}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out"
            style={{ opacity: i === heroIndex ? 1 : 0 }}
          />
        ))}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(22,24,38,.15) 0%, rgba(22,24,38,.35) 55%, #161826 96%)' }}
        />
        <div className="absolute left-4 top-3.5 text-[11px] tracking-[0.08em] text-neutral-200 font-medium" style={{ textShadow: '0 1px 4px rgba(0,0,0,.5)' }}>
          100 &nbsp;→&nbsp; 200 &nbsp;→&nbsp; 300 REPS A DAY
        </div>
        <div className="absolute left-4 bottom-3.5 text-[13px] font-medium text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,.5)' }}>
          {EXERCISE_REFERENCE[HERO_CYCLE[heroIndex]].name}
        </div>
      </div>

      <div className="flex flex-col gap-2.25 mt-3.5">
        <Button
          variant="primary" block className="h-12 text-[15px]"
          onClick={() => navigate('/onboarding/name')}
        >
          Find my starting point
        </Button>
        <Button
          variant="secondary" block className="h-11"
          onClick={() => navigate('/onboarding/name', { state: { skipAhead: true } })}
        >
          I already train, skip ahead
        </Button>
        <div className="flex justify-center gap-2 mt-1.5">
          <Tag variant="neutral">Free forever</Tag>
          <Tag variant="neutral">Works offline</Tag>
          <Tag variant="neutral">No account needed</Tag>
        </div>
      </div>
    </div>
  );
}
