import React from 'react';
import { cn } from '@/lib/utils';

const variants: Record<string, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/80',
  outline: 'border-border bg-background hover:bg-muted hover:text-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizes: Record<string, string> = {
  default: 'h-8 gap-1.5 px-2.5', xs: 'h-6 gap-1 rounded-md px-2 text-xs',
  sm: 'h-7 gap-1 rounded-md px-2.5 text-xs', lg: 'h-9 gap-1.5 px-3', icon: 'size-8',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
  children: React.ReactNode;
};

export function Button({ className, variant = 'default', size = 'default', asChild, children, ...props }: ButtonProps) {
  const classes = cn('inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', variants[variant], sizes[size], className);
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, { className: cn(classes, child.props.className) });
  }
  return <button {...props} className={classes}>{children}</button>;
}
