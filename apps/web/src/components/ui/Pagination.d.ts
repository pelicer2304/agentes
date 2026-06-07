export interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    className?: string;
}
declare function Pagination({ currentPage, totalPages, onPageChange, className, }: PaginationProps): import("react/jsx-runtime").JSX.Element | null;
export { Pagination };
