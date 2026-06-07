import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

function Card({ className, title, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-card p-4',
        className
      )}
      {...props}
    >
      {title && (
        <h3 className="mb-3 text-lg font-semibold text-foreground">{title}</h3>
      )}
      {children}
    </div>
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex flex-col space-y-1.5 pb-3', className)} {...props} />
  );
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cn('text-foreground', className)} {...props} />;
}

export { Card, CardHeader, CardContent };
