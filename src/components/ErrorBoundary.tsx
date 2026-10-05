import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors that would otherwise leave a blank screen with no
 * way back in (this is what made the reset-all-data bug hard to diagnose:
 * the crash was silent). React only supports error boundaries as classes. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-[100svh] bg-bg text-text flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-[15px] font-medium">Something went wrong</span>
          <span className="text-[12.5px] leading-[1.5] text-neutral-500 max-w-[280px]">
            The app hit an unexpected error. Reloading usually fixes it; your data on this device is untouched.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 h-11 px-5 rounded-md border border-accent text-accent text-sm font-medium cursor-pointer"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
