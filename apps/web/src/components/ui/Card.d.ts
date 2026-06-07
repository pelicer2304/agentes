import * as React from 'react';
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string;
}
declare function Card({ className, title, children, ...props }: CardProps): import("react/jsx-runtime").JSX.Element;
export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
}
declare function CardHeader({ className, ...props }: CardHeaderProps): import("react/jsx-runtime").JSX.Element;
export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
}
declare function CardContent({ className, ...props }: CardContentProps): import("react/jsx-runtime").JSX.Element;
export { Card, CardHeader, CardContent };
