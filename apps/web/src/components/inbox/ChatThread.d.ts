import type { ConversationMessage } from '@/types';
interface ChatThreadProps {
    messages: ConversationMessage[];
}
/**
 * Renders the full chat: client messages, DecodificaIA messages, and team
 * manual messages (Req 16.2). Inbound messages align left, outbound right.
 */
export declare function ChatThread({ messages }: ChatThreadProps): import("react/jsx-runtime").JSX.Element;
export {};
