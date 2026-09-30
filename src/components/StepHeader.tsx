import { ChevronLeft } from 'lucide-react';
import Button from './Button';

interface StepHeaderProps {
  step: number;
  of: number;
  onBack: () => void;
}

/** Back button and progress for the onboarding steps. Segmented rather than a
 * single bar, so "two short steps" is visible at a glance. */
export default function StepHeader({ step, of, onBack }: StepHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="icon" aria-label="Back" onClick={onBack}><ChevronLeft size={18} /></Button>
      <div className="flex-1 flex gap-1.5" aria-label={`Step ${step} of ${of}`}>
        {Array.from({ length: of }, (_, i) => (
          <i
            key={i}
            className="block flex-1 h-[3px] rounded-full transition-colors duration-300"
            style={{ background: i < step ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-text) 12%, transparent)' }}
          />
        ))}
      </div>
      <span className="text-[11px] text-neutral-500 flex-none tabular-nums">{step} of {of}</span>
    </div>
  );
}
