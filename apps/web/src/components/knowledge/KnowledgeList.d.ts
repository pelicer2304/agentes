import type { KnowledgeGrouped, KnowledgeItem } from '@/types';
interface KnowledgeListProps {
    items: KnowledgeGrouped;
    onEdit: (item: KnowledgeItem) => void;
    onToggleActive: (item: KnowledgeItem) => void;
}
export declare function KnowledgeList({ items, onEdit, onToggleActive }: KnowledgeListProps): import("react/jsx-runtime").JSX.Element;
export {};
