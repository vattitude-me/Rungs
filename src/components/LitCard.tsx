import type { ReactNode } from 'react';
import { tint } from '../theme';

interface LitCardProps {
  children: ReactNode;
  className?: string;
}

/** Gradient + accent-bloom panel. Nocturne rule: max one lit surface per screen. */
export default function LitCard({ children, className = '' }: LitCardProps) {
  return (
    <div
      className="relative flex-none overflow-hidden rounded-2xl shadow-sm"
      // It sits in scrolling flex columns, where overflow-hidden lets it shrink
      // below its content; the min-height keeps it at full size.
      style={{
        background: 'linear-gradient(150deg, var(--color-lit-from), var(--color-lit-to))',
        height: 'auto',
        minHeight: 'fit-content',
      }}
    >
      <div
        className="absolute -top-15 -right-10 w-[180px] h-[180px] rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${tint('var(--color-accent)', 22)}, transparent 68%)` }}
      />
      <div className={['relative', className].join(' ')}>{children}</div>
    </div>
  );
}
