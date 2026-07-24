import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../../hooks/AuthContext';
import { setAccessToken } from '../../../services/auth/tokenStore';
import LoginPage from '../LoginPage';

const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockApiPost = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mockApiPost,
      get: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
    post: mockAxiosPost,
  },
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function DashboardPage() {
  return <div>Dashboard Page</div>;
}

function MyDeliveriesPage() {
  return <div>My Deliveries Page</div>;
}

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/my-deliveries" element={<MyDeliveriesPage />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    setAccessToken(null);
    mockAxiosPost.mockReset();
    mockApiPost.mockReset();
    mockAxiosPost.mockRejectedValue(new Error('No session'));
  });

  it('disables submit button when form fields are empty', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const submitBtn = screen.getByRole('button', { name: /^Se connecter$/i });
    expect(submitBtn).toBeDisabled();
  });

  it('shows error message on 401 response', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    mockApiPost.mockRejectedValue({
      response: { status: 401, data: { message: 'Invalid credentials' } },
    });

    const emailInput = screen.getByLabelText('Adresse email');
    const passwordInput = screen.getByLabelText('Mot de passe');

    fireEvent.change(emailInput, { target: { value: 'test@test.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password' } });

    const submitBtn = screen.getByRole('button', { name: /^Se connecter$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Ces identifiants ne correspondent à aucun compte/)).toBeTruthy();
    });
  });

  it('redirects admin to /dashboard after login', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    mockApiPost.mockResolvedValue({
      data: {
        accessToken: 'fake-token',
        user: { id: '1', email: 'admin@test.com', role: 'admin', companyId: 'c1', firstName: 'A', lastName: 'B' },
      },
    });

    const emailInput = screen.getByLabelText('Adresse email');
    const passwordInput = screen.getByLabelText('Mot de passe');

    fireEvent.change(emailInput, { target: { value: 'admin@test.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password' } });

    const submitBtn = screen.getByRole('button', { name: /^Se connecter$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Dashboard Page')).toBeTruthy();
    });
  });

  it('redirects driver to /my-deliveries after login', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    mockApiPost.mockResolvedValue({
      data: {
        accessToken: 'fake-token',
        user: { id: '2', email: 'driver@test.com', role: 'driver', companyId: 'c1', firstName: 'C', lastName: 'D' },
      },
    });

    const emailInput = screen.getByLabelText('Adresse email');
    const passwordInput = screen.getByLabelText('Mot de passe');

    fireEvent.change(emailInput, { target: { value: 'driver@test.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password' } });

    const submitBtn = screen.getByRole('button', { name: /^Se connecter$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('My Deliveries Page')).toBeTruthy();
    });
  });
});
