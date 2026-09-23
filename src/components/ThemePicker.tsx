import { Check } from 'lucide-react';
import { THEMES, type ThemeId } from '../theme';

interface ThemePickerProps {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
}

/** One tile per colour theme, each drawn in that theme's own ground and
 * accent. The tiles use the theme's literal colours rather than the live CSS
 * variables, which only ever hold the theme that is currently on. */
export default function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-5 gap-2">
      {THEMES.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.id)}
            className="flex flex-col items-center gap-1.5 cursor-pointer"
          >
            <span
              className="relative w-full aspect-square max-w-14 rounded-[14px] grid place-items-center transition-shadow"
              style={{
                background: t.bg,
                boxShadow: active
                  ? `0 0 0 2px ${t.accent}`
                  : '0 0 0 1px var(--color-neutral-800)',
              }}
            >
              <span
                className="w-6 h-6 rounded-full grid place-items-center"
                style={{ background: t.accent, color: t.bg }}
              >
                {active && <Check size={14} strokeWidth={3} />}
              </span>
            </span>
            <span className={`text-[11px] ${active ? 'text-text font-medium' : 'text-neutral-500'}`}>
              {t.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
