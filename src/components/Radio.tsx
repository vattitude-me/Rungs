import type { ReactNode } from 'react';

interface RadioProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}

export default function Radio({ selected, onSelect, title, subtitle, trailing }: RadioProps) {
  return (
    <div
      onClick={onSelect}
      className={[
        'flex items-center gap-3 p-3.5 rounded-[14px] bg-surface cursor-pointer',
        selected ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'shadow-sm',
      ].join(' ')}
    >
      <span
        className={[
          'w-4 h-4 flex-none rounded-full border-[1.5px]',
          selected ? 'bg-accent border-accent shadow-[inset_0_0_0_4px_var(--color-bg)]' : 'border-neutral-700 bg-transparent',
        ].join(' ')}
      />
      <span className="flex-1 flex flex-col gap-px">
        <span className="text-[14.5px] font-medium">{title}</span>
        {subtitle && <span className="text-[11.5px] text-neutral-500">{subtitle}</span>}
      </span>
      {trailing}
    </div>
  );
}
