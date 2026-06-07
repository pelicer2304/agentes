import { AUTH_TOKEN_KEY } from '@/api/client';
export type UserRole = 'admin' | 'atendente';
export interface AuthUser {
    id: string;
    email: string;
    role: UserRole;
}
declare const USER_STORAGE_KEY = "auth_user";
export interface UseAuthReturn {
    token: string | null;
    user: AuthUser | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}
export declare function useAuth(): UseAuthReturn;
export { AUTH_TOKEN_KEY, USER_STORAGE_KEY };
