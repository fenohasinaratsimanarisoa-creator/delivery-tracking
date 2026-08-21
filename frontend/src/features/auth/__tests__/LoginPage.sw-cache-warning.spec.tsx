import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../../hooks/AuthContext';
import { setAccessToken } from '../../../services/auth/tokenStore';
import LoginPage from '../LoginPage';

const mockApiPost = vi.hoisted(() => vi.fn());
const mockResetServiceWorker = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
    post: mockApiPost,
  },
}));

vi.mock('../../../services/pwa/reset', () => ({
  resetServiceWorkerAndReload: (...args: unknown[]) => mockResetServiceWorker(...args),
}));

function renderPage(entry = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage — SW cache warning', () => {
  beforeEach(() => {
    setAccessToken(null);
    sessionStorage.clear();
    mockResetServiceWorker.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('n\'affiche PAS le warning si sessionStorage est vide', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('affiche le warning si dt_sw_reset date de < 30s', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 5000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/ancienne version de l'application/i)).toBeTruthy();
  });

  it('affiche le warning si dt_chunk_reload date de < 30s', async () => {
    sessionStorage.setItem('dt_chunk_reload', String(Date.now() - 10000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('N\'affiche PAS le warning si dt_sw_reset date de > 30s', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 60000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('le bouton "Réinitialiser l\'application" appelle resetServiceWorkerAndReload', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 3000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    const btn = screen.getByRole('button', { name: /réinitialiser/i });
    expect(btn).toBeTruthy();
    expect(mockResetServiceWorker).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(mockResetServiceWorker).toHaveBeenCalledTimes(1);
  });

  it('utilise le plus récent entre dt_sw_reset et dt_chunk_reload', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 120000));
    sessionStorage.setItem('dt_chunk_reload', String(Date.now() - 2000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('le warning contient un bouton réinitialiser avec icône', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 3000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    const btn = screen.getByRole('button', { name: /réinitialiser/i });
    expect(btn.textContent).toContain('🔄');
  });

  it('le warning est un élément role=alert', async () => {
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 3000));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('ferme complètement le navigateur');
  });
});
