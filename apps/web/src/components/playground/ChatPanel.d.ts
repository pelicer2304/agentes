import type { Message } from '@/types';
export interface ChatPanelProps {
    messages: Message[];
    isLoading?: boolean;
    className?: string;
}
export declare function ChatPanel({ messages, isLoading, className }: ChatPanelProps): import("react/jsx-runtime").JSX.Element;
