import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'text-accent border border-accent hover:bg-accent/12 active:bg-accent/22',
  secondary: 'text-text border border-neutral-800 hover:bg-text/7 active:bg-text/14',
  ghost: 'text-accent border-0 hover:bg-accent/10 active:bg-accent/18',
  icon: 'text-text border border-neutral-800 hover:bg-text/7 active:bg-text/14 w-9 h-9 p-0',
  danger: 'text-danger border border-danger hover:bg-danger/12 active:bg-danger/22',
};

export default function Button({
  variant = 'primary', block, className = '', children, ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-1.5 cursor-pointer select-none',
        'font-medium text-sm rounded-md bg-transparent transition-colors',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        variant !== 'icon' ? 'px-4 h-11' : '',
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
