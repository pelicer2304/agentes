import type { KnowledgeGrouped, KnowledgeItem } from '@/types';
interface CreateKnowledgePayload {
    category: string;
    title: string;
    content: string;
}
interface UpdateKnowledgePayload {
    category?: string;
    title?: string;
    content?: string;
    active?: boolean;
}
export declare function useKnowledge(): {
    items: NoInfer<KnowledgeGrouped>;
    isLoading: boolean;
    error: Error | null;
    create: import("@tanstack/react-query").UseMutateAsyncFunction<KnowledgeItem, Error, CreateKnowledgePayload, unknown>;
    update: import("@tanstack/react-query").UseMutateAsyncFunction<KnowledgeItem, Error, UpdateKnowledgePayload & {
        id: string;
    }, unknown>;
    toggleActive: (item: KnowledgeItem) => void;
    isCreating: boolean;
    isUpdating: boolean;
};
export {};
