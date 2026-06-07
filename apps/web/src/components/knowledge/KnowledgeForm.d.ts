import type { KnowledgeItem } from '@/types';
interface KnowledgeFormProps {
    item?: KnowledgeItem | null;
    onSave: (data: {
        category: string;
        title: string;
        content: string;
    }) => Promise<void>;
    onCancel: () => void;
    isLoading?: boolean;
}
export declare function KnowledgeForm({ item, onSave, onCancel, isLoading }: KnowledgeFormProps): import("react/jsx-runtime").JSX.Element;
export {};
