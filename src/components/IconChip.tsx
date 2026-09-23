import type { ReactNode } from 'react';
import type { Exercise } from '../types';
import { EXERCISE_CHIP_BG } from '../types';

interface IconChipProps {
  children: ReactNode;
  exercise?: Exercise;
  bg?: string;
  size?: number;
}

export default function IconChip({ children, exercise, bg, size = 38 }: IconChipProps) {
  const background = bg ?? (exercise ? EXERCISE_CHIP_BG[exercise] : 'var(--color-neutral-800)');
  return (
    <span
      style={{ width: size, height: size, background }}
      className="flex-none rounded-[11px] grid place-items-center text-accent-100"
    >
      {children}
    </span>
  );
}
