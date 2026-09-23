import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Close handlers for the sheets currently open, innermost last.
 *
 * Android's back gesture has to close a sheet before it navigates anywhere -
 * otherwise "back" from the nudge picker leaves Squad entirely, which is the
 * opposite of what every other Android app does. useAndroidBackButton asks
 * here first. */
const openSheets: (() => void)[] = [];

/** Closes the top-most open sheet. Returns false when none was open. */
export function closeTopSheet(): boolean {
  const close = openSheets[openSheets.length - 1];
  if (!close) return false;
  close();
  return true;
}

interface SheetProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Leading content in the header row, e.g. a friend's avatar. */
  leading?: ReactNode;
  /** Caps the panel height so long content scrolls inside it. */
  maxHeight?: string;
}

/**
 * The bottom sheet every confirmation and picker uses.
 *
 * There used to be five hand-rolled copies of this, with three different
 * scrim colours between them, none announced as a dialog, none closable from
 * the keyboard - and the ones using `position: fixed` escaped the phone frame
 * on desktop and pinned themselves to the bottom of the browser window. It
 * portals into the app viewport instead, so it covers exactly the app.
 */
export default function Sheet({ title, onClose, children, leading, maxHeight = '85%' }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest onClose, without re-running the registration effect whenever a
  // parent passes a fresh arrow function.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const close = () => closeRef.current();
    openSheets.push(close);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openSheets.lastIndexOf(close);
      if (i >= 0) openSheets.splice(i, 1);
      previouslyFocused?.focus?.();
    };
  }, []);

  const host = document.getElementById('app-viewport') ?? document.body;

  return createPortal(
    <div
      className="scrim-enter absolute inset-0 z-50 flex items-end justify-center bg-scrim"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight }}
        className="sheet-enter w-full max-w-[440px] rounded-t-[22px] bg-surface px-5 pt-2.5 pb-action flex flex-col gap-3 overflow-y-auto outline-none"
      >
        <span aria-hidden className="self-center w-9 h-1 rounded-full bg-text/15 mb-1" />
        <div className="flex items-center gap-2.75">
          {leading}
          <span id={titleId} className="flex-1 text-[15px] font-medium">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 -mr-1.5 flex-none rounded-full grid place-items-center text-neutral-400 bg-text/7 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    host,
  );
}
