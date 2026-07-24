import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import ProtectedRoute from '../ProtectedRoute';

function TestPage() {
  return <div>Protected content</div>;
}

function LoginPage() {
  return <div>Login page</div>;
}

function ForbiddenPage() {
  return <div>Forbidden</div>;
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it('redirects unauthenticated user to /login', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/protected" element={
              <ProtectedRoute><TestPage /></ProtectedRoute>
            } />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText('Login page')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('redirects user with wrong role to /dashboard', async () => {
    const driverPayload = {
      sub: '123', email: 'driver@test.com', role: 'driver', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(driverPayload)) + '.sig';
    setAccessToken(token);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin-only']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="/admin-only" element={
              <ProtectedRoute roles={['admin']}><TestPage /></ProtectedRoute>
            } />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText('Forbidden')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('allows authenticated user with correct role', async () => {
    const adminPayload = {
      sub: '123', email: 'admin@test.com', role: 'admin', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(adminPayload)) + '.sig';
    setAccessToken(token);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin-only']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin-only" element={
              <ProtectedRoute roles={['admin']}><TestPage /></ProtectedRoute>
            } />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText('Protected content')).toBeTruthy();
  });

  it('allows authenticated user when no roles specified', async () => {
    const userPayload = {
      sub: '123', email: 'user@test.com', role: 'client', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(userPayload)) + '.sig';
    setAccessToken(token);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/any']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/any" element={
              <ProtectedRoute><TestPage /></ProtectedRoute>
            } />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText('Protected content')).toBeTruthy();
  });
});
