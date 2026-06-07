import type { Lead } from '@/types';
interface LeadsTableProps {
    leads: Lead[];
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}
export declare function LeadsTable({ leads, currentPage, totalPages, onPageChange, }: LeadsTableProps): import("react/jsx-runtime").JSX.Element;
export {};
