import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import FleetPage from '../FleetPage';

const { mockApiGet, mockApiPost, mockApiPatch, mockApiDelete } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPatch: vi.fn(),
  mockApiDelete: vi.fn(),
}));

vi.mock('../../services/api/client', () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost,
    patch: mockApiPatch,
    delete: mockApiDelete,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock('../../components/Toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseMutation = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function DashboardPage() {
  return <div>Dashboard Page</div>;
}

function renderPage(initialEntries = ['/fleet']) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fleet" element={<FleetPage />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('FleetPage', () => {
  const mockVehicles = [
    {
      id: 'veh-1',
      brand: 'Toyota',
      model: 'Hilux',
      year: 2024,
      licensePlate: 'AB-123-CD',
      fuelType: 'Diesel',
      isActive: true,
    },
    {
      id: 'veh-2',
      brand: 'Renault',
      model: 'Kangoo',
      year: 2023,
      licensePlate: 'EF-456-GH',
      fuelType: 'Essence',
      isActive: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);

    const responseData = { data: mockVehicles, meta: { total: 2, page: 1, limit: 20, totalPages: 1 } };

    mockApiGet.mockResolvedValue({ data: responseData });
    mockApiPost.mockResolvedValue({ data: { ...mockVehicles[0], id: 'veh-3' } });
    mockApiPatch.mockResolvedValue({ data: mockVehicles[0] });
    mockApiDelete.mockResolvedValue({ data: {} });

    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'traccar-devices') {
        return { data: [], isLoading: false };
      }
      return { data: responseData, isLoading: false };
    });
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('renders page title and vehicle count', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Flotte')).toBeInTheDocument();
    expect(screen.getByText('2 véhicules dans votre flotte')).toBeInTheDocument();
  });

  it('shows search input', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByPlaceholderText('Rechercher un véhicule…')).toBeInTheDocument();
  });

  it('shows create vehicle button', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByRole('button', { name: /Nouveau véhicule/i })).toBeInTheDocument();
  });

  it('renders vehicles table with data', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Toyota')).toBeInTheDocument();
    expect(screen.getByText('Hilux')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('AB-123-CD')).toBeInTheDocument();
    expect(screen.getByText('Diesel')).toBeInTheDocument();
    expect(screen.getByText('Renault')).toBeInTheDocument();
    expect(screen.getByText('Kangoo')).toBeInTheDocument();
  });

  it('shows active/inactive status toggle', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const activeButton = screen.getByTitle('Désactiver');
    expect(activeButton).toBeInTheDocument();
  });

  it('filters vehicles by search term', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const searchInput = screen.getByPlaceholderText('Rechercher un véhicule…');
    fireEvent.change(searchInput, { target: { value: 'Toyota' } });

    await waitFor(() => {
      expect(screen.getByText('Toyota')).toBeInTheDocument();
      expect(screen.queryByText('Renault')).not.toBeInTheDocument();
    });
  });

  it('opens create drawer when clicking new vehicle button', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const buttons = screen.getAllByText('Nouveau véhicule');
    fireEvent.click(buttons[0]);

    expect(screen.getByText('Ajoutez un véhicule à votre flotte')).toBeInTheDocument();
  });

  it('shows empty state when no vehicles', async () => {
    const emptyData = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } };
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'traccar-devices') {
        return { data: [], isLoading: false };
      }
      return { data: emptyData, isLoading: false };
    });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Aucun véhicule enregistré')).toBeInTheDocument();
    expect(screen.getByText('Ajoutez le premier véhicule à votre flotte')).toBeInTheDocument();
  });

  it('shows skeleton loading state initially', async () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'traccar-devices') {
        return { data: [], isLoading: false };
      }
      return { data: null, isLoading: true };
    });
    mockUseMutation.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

    renderPage();

    expect(screen.getByText('Flotte')).toBeInTheDocument();
    expect(screen.getByText('Marque')).toBeInTheDocument();
    expect(screen.getByText('Modèle')).toBeInTheDocument();
  });
});