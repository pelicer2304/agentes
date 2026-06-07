/** localStorage key under which the JWT access token is persisted. */
export declare const AUTH_TOKEN_KEY = "auth_token";
declare const apiClient: import("axios").AxiosInstance;
/** Reads the persisted JWT, returning null when none is stored. */
export declare function getStoredToken(): string | null;
/**
 * Persists (or clears) the JWT and keeps the axios default Authorization
 * header in sync so every subsequent request is authenticated.
 */
export declare function setAuthToken(token: string | null): void;
/**
 * Event name dispatched on `window` when the API returns 403 (forbidden).
 * The UI can listen for this to surface an inline notice.
 */
export declare const FORBIDDEN_EVENT = "api:forbidden";
export default apiClient;
