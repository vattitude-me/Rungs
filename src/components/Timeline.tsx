import type { ReactNode } from 'react';

/** 'missed' is its own state rather than a flavour of 'later': the window is
 * behind you, but it is still yours to do, so it reads as waiting rather than
 * as greyed-out and finished with. */
export type TimelineDotState = 'done' | 'now' | 'missed' | 'later';

interface TimelineRowProps {
  time: string;
  state: TimelineDotState;
  /** Makes the whole row the tap target. Omit for a row that isn't startable. */
  onClick?: () => void;
  children: ReactNode;
}

const DOT_BG: Record<TimelineDotState, string> = {
  done: 'var(--color-accent)',
  now: 'var(--color-text)',
  missed: 'var(--color-gold)',
  later: 'color-mix(in srgb, var(--color-text) 20%, transparent)',
};

export function TimelineRow({ time, state, onClick, children }: TimelineRowProps) {
  const rowClass = 'flex-1 flex items-center gap-2.5 px-3.5 py-2.5 my-1 rounded-xl bg-surface text-left w-full';
  // Only a window still ahead of you is dimmed. A missed one sits at full
  // strength because it is the one most likely to be tapped.
  const style = { opacity: state === 'later' ? 0.6 : 1 };

  return (
    <div className="flex items-stretch gap-3">
      <div className="w-[42px] flex-none text-right text-[11px] tabular-nums text-neutral-500 pt-3.5">
        {time}
      </div>
      <div className="w-3.5 flex-none flex flex-col items-center">
        <span className="w-0.5 flex-1 block bg-text/10" />
        <span
          style={{
            background: DOT_BG[state],
            boxShadow: state === 'now' ? '0 0 0 5px color-mix(in srgb, var(--color-accent) 22%, transparent)' : 'none',
          }}
          className="w-[11px] h-[11px] rounded-full flex-none block"
        />
        <span className="w-0.5 flex-1 block bg-text/10" />
      </div>
      {onClick ? (
        <button type="button" onClick={onClick} style={style} className={`${rowClass} cursor-pointer`}>
          {children}
        </button>
      ) : (
        <div style={style} className={rowClass}>{children}</div>
      )}
    </div>
  );
}
