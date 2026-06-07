import type { ConversationDetail } from '@/types';
/**
 * Loads a conversation's full chat + lead side panel (Req 16.2, 16.3). Polls
 * every 3s so incoming/outgoing messages appear in near real time.
 */
export declare function useConversationDetail(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<ConversationDetail>, Error>;
type ConversationAction = 'assumir' | 'pausar' | 'retomar' | 'converter' | 'perdido';
/**
 * Mutations for the conversation actions (Req 16.4): takeover, pause/resume,
 * convert/lost, and manual message send. Each refreshes the detail and inbox
 * caches on success so the UI reflects the new state immediately.
 */
export declare function useConversationActions(id: string | undefined): {
    takeover: () => void;
    pause: () => void;
    resume: () => void;
    markConverted: () => void;
    markLost: () => void;
    isActing: boolean;
    actionError: boolean;
    pendingAction: ConversationAction | null;
    sendMessage: (content: string) => void;
    sendMessageAsync: (content: string) => Promise<ConversationDetail>;
    isSending: boolean;
    sendError: string | null;
    resetSend: () => void;
};
export {};
