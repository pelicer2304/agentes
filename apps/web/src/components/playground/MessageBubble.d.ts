export interface MessageBubbleProps {
    content: string;
    role: 'user' | 'assistant';
    createdAt: string;
    className?: string;
}
export declare function MessageBubble({ content, role, createdAt, className }: MessageBubbleProps): import("react/jsx-runtime").JSX.Element;
