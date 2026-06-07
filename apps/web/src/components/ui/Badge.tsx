import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-card text-foreground border-border',
    success: 'bg-accent-dark text-accent border-accent/30',
    warning: 'bg-yellow-900/30 text-yellow-400 border-yellow-400/30',
    danger: 'bg-red-900/30 text-red-400 border-red-400/30',
    info: 'bg-blue-900/30 text-blue-400 border-blue-400/30',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
