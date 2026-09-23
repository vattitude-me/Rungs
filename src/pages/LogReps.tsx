import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Button from '../components/Button';
import IconChip from '../components/IconChip';
import type { Exercise } from '../types';
import { EXERCISE_LABELS, EXERCISE_ICON, EXERCISE_COLOR } from '../types';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

export default function LogReps() {
  const navigate = useNavigate();

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-6 gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" aria-label="Back" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <div className="text-[15px] font-medium">Log reps</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[22px] font-medium tracking-[-0.02em]">Bank some extra reps</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          Outside your windows? No problem, count up and add it to today's total.
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {EXERCISES.map((ex) => (
          <button
            key={ex}
            onClick={() => navigate(`/session?exercise=${ex}&adhoc=1`)}
            className="flex items-center gap-3.25 px-3.5 py-3.5 rounded-[14px] bg-surface shadow-sm cursor-pointer text-left"
          >
            <IconChip exercise={ex} size={40}>
              <span className="text-[17px]">{EXERCISE_ICON[ex]}</span>
            </IconChip>
            <span className="flex-1 flex flex-col gap-px">
              <span className="text-[15px] font-medium">{EXERCISE_LABELS[ex]}</span>
              <span className="text-[11.5px] text-neutral-500">Count up, bank whenever you stop</span>
            </span>
            <span className="text-[13px]" style={{ color: EXERCISE_COLOR[ex] }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
