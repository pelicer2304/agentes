import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import { AUTH_TOKEN_KEY } from '@/api/client';

function renderGuarded(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Screen</div>} />
        <Route element={<AuthGuard />}>
          <Route path="/secret" element={<div>Secret Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthGuard', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('redirects to /login when there is no token', () => {
    localStorage.clear();
    renderGuarded('/secret');
    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  });

  it('renders protected content when a token is present', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'valid-token');
    renderGuarded('/secret');
    expect(screen.getByText('Secret Content')).toBeInTheDocument();
  });
});
