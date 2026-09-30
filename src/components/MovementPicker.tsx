import { Check, ExternalLink } from 'lucide-react';
import Sheet from './Sheet';
import { MOVEMENTS, movementsFor, wikipediaUrl, EQUIPMENT_LABELS, type Movement } from '../data/movements';
import type { Equipment, Exercise } from '../types';
import { SLOT_LABELS, EXERCISE_COLOR } from '../types';

/** Five dots, filled to the movement's level - difficulty at a glance. */
export function LevelDots({ level, color = 'var(--color-accent)' }: { level: number; color?: string }) {
  return (
    <span className="flex gap-[3px]" aria-label={`Difficulty ${level} of 6`}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <i
          key={i}
          className="block w-[5px] h-[5px] rounded-full"
          style={{ background: i <= level ? color : 'color-mix(in srgb, var(--color-text) 14%, transparent)' }}
        />
      ))}
    </span>
  );
}

interface MovementPickerProps {
  slot: Exercise;
  equipment: Equipment[];
  currentId: string;
  onPick: (m: Movement) => void;
  onClose: () => void;
  /** Extra line under the title, e.g. "Just for this set". */
  note?: string;
}

/** Choose how to fill a slot. Lists what the user's kit allows, easiest
 * first, and says what else extra kit would open up rather than hiding it. */
export default function MovementPicker({ slot, equipment, currentId, onPick, onClose, note }: MovementPickerProps) {
  const options = movementsFor(slot, equipment);
  const locked = MOVEMENTS.filter((m) => m.slot === slot && !options.includes(m));
  const lockedKit = [...new Set(locked.flatMap((m) => m.needs.filter((n) => !equipment.includes(n))))];
  const color = EXERCISE_COLOR[slot];

  return (
    <Sheet title={`${SLOT_LABELS[slot]} moves`} onClose={onClose} maxHeight="88%">
      {note && <div className="text-[12px] text-neutral-500 -mt-1.5">{note}</div>}
      <div className="flex flex-col gap-1.5" role="listbox" aria-label={`${SLOT_LABELS[slot]} moves`}>
        {options.map((m) => {
          const on = m.id === currentId;
          return (
            <div
              key={m.id}
              className={[
                'flex items-center gap-3 rounded-[13px] transition-colors',
                on ? 'bg-accent/12 shadow-[inset_0_0_0_1px_var(--color-accent-600)]' : 'bg-bg/60',
              ].join(' ')}
            >
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onPick(m)}
                className="flex-1 flex flex-col gap-1 pl-3.5 py-3 text-left cursor-pointer min-w-0"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{m.name}</span>
                  {on && <Check size={14} strokeWidth={2.6} className="text-accent-300" />}
                </span>
                <span className="text-[11.5px] leading-[1.4] text-neutral-500">{m.cue}</span>
                <span className="flex items-center gap-2 pt-0.5">
                  <LevelDots level={m.level} color={color} />
                  {m.needs.length > 0 && (
                    <span className="text-[10.5px] text-neutral-600">{m.needs.map((n) => EQUIPMENT_LABELS[n]).join(' + ')}</span>
                  )}
                </span>
              </button>
              <a
                href={wikipediaUrl(m)}
                target="_blank"
                rel="noreferrer"
                aria-label={`${m.name} on Wikipedia`}
                className="w-11 self-stretch grid place-items-center text-neutral-600 hover:text-accent-300 flex-none"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          );
        })}
      </div>
      {lockedKit.length > 0 && (
        <div className="text-[11.5px] leading-[1.5] text-neutral-600 px-0.5">
          {locked.length} more with {lockedKit.map((k) => EQUIPMENT_LABELS[k].toLowerCase()).join(' or ')}.
          Add kit in Profile → Your workout.
        </div>
      )}
    </Sheet>
  );
}
