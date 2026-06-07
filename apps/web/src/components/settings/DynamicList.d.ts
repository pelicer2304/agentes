export interface DynamicListProps {
    label: string;
    items: string[];
    maxItems: number;
    maxItemLength: number;
    onChange: (items: string[]) => void;
}
export declare function DynamicList({ label, items, maxItems, maxItemLength, onChange, }: DynamicListProps): import("react/jsx-runtime").JSX.Element;
