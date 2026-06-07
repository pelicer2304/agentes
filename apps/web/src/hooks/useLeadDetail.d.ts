import type { Lead, Conversation, AgentAnalysis } from '@/types';
export interface LeadDetail extends Lead {
    conversations: (Conversation & {
        messages: Array<{
            id: string;
            conversationId: string;
            role: 'user' | 'assistant' | 'system';
            direction: string;
            content: string;
            metadata: Record<string, unknown> | null;
            createdAt: string;
        }>;
    })[];
    agentAnalyses: AgentAnalysis[];
}
export declare function useLeadDetail(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<LeadDetail>, Error>;
export declare function useUpdateLeadStatus(id: string | undefined): import("@tanstack/react-query").UseMutationResult<Lead, Error, string, unknown>;
