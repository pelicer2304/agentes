import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AxiosError } from 'axios';
import { LoginPage } from './LoginPage';
import apiClient, { AUTH_TOKEN_KEY } from '@/api/client';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('logs in, stores the token and navigates home on success', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        accessToken: 'jwt-123',
        user: { id: 'u1', email: 'a@b.com', role: 'admin' },
      },
    });

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('E-mail'), 'a@b.com');
    await user.type(screen.getByLabelText('Senha'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(screen.getByText('Home Dashboard')).toBeInTheDocument();
    });

    expect(postSpy).toHaveBeenCalledWith('/auth/login', {
      email: 'a@b.com',
      password: 'secret',
    });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-123');
  });

  it('shows an error message when credentials are invalid', async () => {
    const error = new AxiosError('Unauthorized');
    // @ts-expect-error partial response is sufficient for the test
    error.response = { status: 401 };
    vi.spyOn(apiClient, 'post').mockRejectedValue(error);

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('E-mail'), 'a@b.com');
    await user.type(screen.getByLabelText('Senha'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail ou senha inválidos.',
    );
    expect(screen.queryByText('Home Dashboard')).not.toBeInTheDocument();
  });
});
