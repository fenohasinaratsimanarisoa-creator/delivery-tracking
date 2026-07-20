import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../hooks/AuthContext';
import ProtectedRoute from '../ProtectedRoute';

// Mock localStorage
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  length: 0,
  key: (_i: number) => null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function TestPage() {
  return <div>Protected content</div>;
}

function LoginPage() {
  return <div>Login page</div>;
}

function DashboardPage() {
  return <div>Dashboard</div>;
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('redirects unauthenticated user to /login', () => {
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

    expect(screen.queryByText('Protected content')).toBeNull();
    expect(screen.getByText('Login page')).toBeTruthy();
  });

  it('redirects user with wrong role to /dashboard', () => {
    // Setup a token with driver role
    const driverPayload = {
      sub: '123', email: 'driver@test.com', role: 'driver', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(driverPayload)) + '.sig';
    localStorageMock.setItem('accessToken', token);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin-only']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/admin-only" element={
              <ProtectedRoute roles={['admin']}><TestPage /></ProtectedRoute>
            } />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.queryByText('Protected content')).toBeNull();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('allows authenticated user with correct role', () => {
    const adminPayload = {
      sub: '123', email: 'admin@test.com', role: 'admin', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(adminPayload)) + '.sig';
    localStorageMock.setItem('accessToken', token);

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

    expect(screen.getByText('Protected content')).toBeTruthy();
  });

  it('allows authenticated user when no roles specified', () => {
    const userPayload = {
      sub: '123', email: 'user@test.com', role: 'client', companyId: 'c1',
    };
    const token = 'header.' + btoa(JSON.stringify(userPayload)) + '.sig';
    localStorageMock.setItem('accessToken', token);

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

    expect(screen.getByText('Protected content')).toBeTruthy();
  });
});
