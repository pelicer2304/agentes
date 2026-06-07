import type { Message, QualificationData } from '@/types';
interface UseConversationReturn {
    conversationId: string | null;
    messages: Message[];
    qualification: QualificationData | null;
    isLoading: boolean;
    isSending: boolean;
    error: string | null;
    createConversation: () => void;
    sendMessage: (content: string) => void;
    resetConversation: () => void;
    clearConversation: () => void;
    isCreating: boolean;
}
export declare function useConversation(): UseConversationReturn;
export {};
