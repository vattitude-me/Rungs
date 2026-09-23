interface ModeChipOption<T extends string> {
  key: T;
  label: string;
}

interface ModeChipProps<T extends string> {
  options: ModeChipOption<T>[];
  value: T;
  onChange: (key: T) => void;
}

export default function ModeChip<T extends string>({ options, value, onChange }: ModeChipProps<T>) {
  return (
    <div role="group" className="flex gap-2">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            type="button"
            key={opt.key}
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={[
              'flex-1 min-h-11 text-center px-1 py-2.5 rounded-[10px] text-[12px] cursor-pointer transition-colors',
              active ? 'bg-accent/14 text-accent-300 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-text/5 text-neutral-500',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
