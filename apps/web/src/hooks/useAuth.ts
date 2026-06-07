import { useCallback, useSyncExternalStore } from 'react';
import { AxiosError } from 'axios';
import apiClient, {
  AUTH_TOKEN_KEY,
  getStoredToken,
  setAuthToken,
} from '@/api/client';

export type UserRole = 'admin' | 'atendente';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface LoginResult {
  accessToken: string;
  user: AuthUser;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

const USER_STORAGE_KEY = 'auth_user';

// ------------------------------------------------------------------
// Module-level store so auth state is shared across every component
// that calls useAuth, kept in sync with localStorage.
// ------------------------------------------------------------------

function readUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

let state: AuthState = {
  token: getStoredToken(),
  user: readUser(),
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AuthState {
  // Reconcile with localStorage so changes made outside this module
  // (initial load, another tab, tests) are reflected. A new object is only
  // created when the token actually diverges, keeping the reference stable
  // for useSyncExternalStore.
  const stored = getStoredToken();
  if (stored !== state.token) {
    state = { token: stored, user: readUser() };
  }
  return state;
}

function setState(next: AuthState) {
  state = next;
  emit();
}

function persistUser(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch {
    /* ignore storage failures */
  }
}

export interface UseAuthReturn {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await apiClient.post<LoginResult>('/auth/login', {
        email,
        password,
      });
      setAuthToken(data.accessToken);
      persistUser(data.user);
      setState({ token: data.accessToken, user: data.user });
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 401) {
        throw new Error('E-mail ou senha inválidos.');
      }
      throw new Error('Falha ao entrar. Tente novamente.');
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    persistUser(null);
    setState({ token: null, user: null });
  }, []);

  return {
    token: snapshot.token,
    user: snapshot.user,
    isAuthenticated: Boolean(snapshot.token),
    login,
    logout,
  };
}

// Re-export so callers can clear auth storage if needed.
export { AUTH_TOKEN_KEY, USER_STORAGE_KEY };
