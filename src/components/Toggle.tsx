interface ToggleProps {
  on: boolean;
  onToggle: () => void;
  size?: 'default' | 'dense';
  /** What the switch turns on, for screen readers - the visible label is
   * usually a sibling span that isn't associated with it. */
  label?: string;
}

export default function Toggle({ on, onToggle, size = 'default', label }: ToggleProps) {
  const dims = size === 'dense'
    ? { w: 42, h: 25, knob: 19 }
    : { w: 44, h: 26, knob: 20 };

  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      style={{ width: dims.w, height: dims.h }}
      className={[
        'flex-none rounded-full p-[3px] cursor-pointer flex items-center transition-colors duration-180',
        on ? 'bg-accent justify-end' : 'bg-neutral-800 justify-start',
      ].join(' ')}
    >
      <span
        style={{ width: dims.knob, height: dims.knob }}
        className="rounded-full bg-text block"
      />
    </span>
  );
}
