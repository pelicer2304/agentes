import axios, { AxiosError } from 'axios';

/** localStorage key under which the JWT access token is persisted. */
export const AUTH_TOKEN_KEY = 'auth_token';

/** Path users are redirected to when their session is missing or expired. */
const LOGIN_PATH = '/login';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Reads the persisted JWT, returning null when none is stored. */
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists (or clears) the JWT and keeps the axios default Authorization
 * header in sync so every subsequent request is authenticated.
 */
export function setAuthToken(token: string | null): void {
  if (token) {
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } catch {
      /* ignore storage failures (e.g. private mode) */
    }
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      /* ignore storage failures */
    }
    delete apiClient.defaults.headers.common.Authorization;
  }
}

// Initialise the default header from any previously stored token so that a
// page refresh keeps the session authenticated.
const initialToken = getStoredToken();
if (initialToken) {
  apiClient.defaults.headers.common.Authorization = `Bearer ${initialToken}`;
}

// --- Request interceptor: attach JWT ---
apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Event name dispatched on `window` when the API returns 403 (forbidden).
 * The UI can listen for this to surface an inline notice.
 */
export const FORBIDDEN_EVENT = 'api:forbidden';

// --- Response interceptor: handle 401 / 403 ---
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;

    if (status === 401) {
      // Session is missing or expired: clear the token and send the user to
      // the login page (unless we are already there).
      setAuthToken(null);
      if (
        typeof window !== 'undefined' &&
        window.location.pathname !== LOGIN_PATH
      ) {
        window.location.assign(LOGIN_PATH);
      }
    } else if (status === 403) {
      // Authenticated but not allowed: surface an inline notice via a window
      // event and reject with a clear, user-facing error.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(FORBIDDEN_EVENT, {
            detail: { url: error.config?.url },
          }),
        );
      }
      return Promise.reject(
        new Error('Você não tem permissão para acessar este recurso.'),
      );
    }

    return Promise.reject(error);
  },
);

export default apiClient;
