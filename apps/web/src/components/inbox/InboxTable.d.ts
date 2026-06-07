import type { InboxListItem } from '@/types';
interface InboxTableProps {
    items: InboxListItem[];
}
/**
 * Renders the WhatsApp conversations inbox list with every column required by
 * Req 16.1. Rows navigate to the conversation detail.
 */
export declare function InboxTable({ items }: InboxTableProps): import("react/jsx-runtime").JSX.Element;
export {};
