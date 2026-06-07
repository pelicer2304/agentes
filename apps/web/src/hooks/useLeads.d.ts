import type { PaginatedLeads } from '@/types';
interface UseLeadsParams {
    page?: number;
    pageSize?: number;
    status?: string;
    temperature?: string;
}
export declare function useLeads(params?: UseLeadsParams): import("@tanstack/react-query").UseQueryResult<NoInfer<PaginatedLeads>, Error>;
export {};
