import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Width alone used to decide this, which broke the moment a phone was turned
 * sideways: a Pixel 9 in landscape is ~923px wide, cleared the old 501px bar,
 * and got the simulated phone frame - an 866px-tall mockup rendered into a
 * ~411px-tall viewport, so only the top half of the app was on screen.
 *
 * A fine pointer is what actually separates a desktop browser from a touch
 * device that merely got wide by being rotated, and the installed app is
 * never a desktop browser whatever its dimensions.
 */
const DESKTOP_QUERY = '(min-width: 501px) and (pointer: fine)';

function matchesDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  if (Capacitor.isNativePlatform()) return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(matchesDesktop);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = () => setIsDesktop(matchesDesktop());
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

function useClock(): string {
  const format = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const [time, setTime] = useState(() => format(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(format(new Date())), 15_000);
    return () => clearInterval(id);
  }, []);

  return time;
}

function StatusBar() {
  const time = useClock();
  return (
    <div className="flex-none flex items-center justify-between px-6 pt-3.5 pb-1.5 text-[12.5px] font-semibold text-text">
      <span>{time}</span>
      <div className="flex items-center gap-1">
        <span className="block w-4 h-2.5 rounded-sm border border-text/60" />
        <span className="block w-5.5 h-2.5 rounded-[3px] border border-text/60 relative">
          <i className="absolute inset-[1.5px] right-1.5 bg-text rounded-[1px] block" />
        </span>
      </div>
    </div>
  );
}

interface PhoneFrameProps {
  children: ReactNode;
}

export default function PhoneFrame({ children }: PhoneFrameProps) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    // No simulated status bar on a real phone - the OS draws its own clock and
    // battery there, and ours would sit on top of it. We just reserve the
    // safe-area height so content clears the notch/cutout.
    return (
      <div className="w-full h-[100dvh] bg-bg text-text flex flex-col overflow-hidden">
        <div className="flex-none safe-top" />
        <div className="flex-1 overflow-hidden relative">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0b0c14] p-8">
      <div
        className="relative flex-none overflow-hidden"
        style={{
          width: 412,
          height: 866,
          padding: 11,
          borderRadius: 46,
          background: 'linear-gradient(160deg, #2b2e3d, #15171f)',
          boxShadow: '0 26px 70px rgba(0,0,0,.7)',
        }}
      >
        <div className="w-full h-full rounded-[36px] overflow-hidden bg-bg text-text flex flex-col relative isolate">
          <StatusBar />
          <div className="flex-1 overflow-hidden relative">{children}</div>
        </div>
        <div
          className="absolute left-1/2 bottom-1.5 -translate-x-1/2 rounded-full"
          style={{ width: 120, height: 4, background: 'rgba(233,233,237,.35)' }}
        />
      </div>
    </div>
  );
}
