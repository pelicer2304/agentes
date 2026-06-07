import type { LogEntry } from '@/types';
interface LogSectionProps {
    title: string;
    entries: LogEntry[];
    /** Field to emphasize per row: the message content or the error text. */
    emphasis?: 'content' | 'error' | 'responseMs';
}
/**
 * Renders a single bucket of operational logs (Req 22.2).
 */
export declare function LogSection({ title, entries, emphasis }: LogSectionProps): import("react/jsx-runtime").JSX.Element;
export {};
