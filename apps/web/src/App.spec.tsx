import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AUTH_TOKEN_KEY } from '@/api/client';

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    // Protected routes require a JWT; seed one so the app renders the
    // authenticated experience instead of redirecting to /login.
    localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders without crashing', () => {
    renderApp();
    expect(screen.getByText('Decodifica')).toBeInTheDocument();
  });

  it('renders the sidebar navigation', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /playground/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /leads/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /configurações/i })).toBeInTheDocument();
  });

  it('renders the Playground page by default', () => {
    renderApp();
    expect(
      screen.getByRole('heading', { name: 'Playground' }),
    ).toBeInTheDocument();
  });

  it('redirects to the login page when not authenticated', () => {
    localStorage.clear();
    renderApp();
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });
});
