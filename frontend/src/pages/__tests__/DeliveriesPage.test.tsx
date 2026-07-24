import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import DeliveriesPage from '../DeliveriesPage';

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

function MyDeliveriesPage() {
  return <div>My Deliveries Page</div>;
}

function renderPage(initialEntries = ['/deliveries']) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/my-deliveries" element={<MyDeliveriesPage />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('DeliveriesPage', () => {
  const mockDeliveries = [
    {
      id: 'del-1',
      title: 'Delivery 1',
      status: 'pending',
      pickupAddress: '123 Pickup St',
      deliveryAddress: '456 Delivery Ave',
      driver: { firstName: 'John', lastName: 'Doe' },
      createdAt: '2026-07-21T10:00:00Z',
    },
    {
      id: 'del-2',
      title: 'Delivery 2',
      status: 'in_progress',
      pickupAddress: '789 Pickup Rd',
      deliveryAddress: '101 Delivery Blvd',
      driver: null,
      createdAt: '2026-07-20T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);

    const responseData = { data: mockDeliveries, meta: { total: 2, page: 1, limit: 20, totalPages: 1 } };

    mockApiGet.mockResolvedValue({ data: responseData });
    mockApiPost.mockResolvedValue({ data: { ...mockDeliveries[0], id: 'del-3' } });
    mockApiPatch.mockResolvedValue({ data: mockDeliveries[0] });
    mockApiDelete.mockResolvedValue({ data: {} });

    mockUseQuery.mockReturnValue({ data: responseData, isLoading: false });
    mockUseMutation.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  });

  it('renders page title and delivery count', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Livraisons')).toBeInTheDocument();
    expect(screen.getByText('2 livraisons')).toBeInTheDocument();
  });

  it('shows search input', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByPlaceholderText('Rechercher une livraison…')).toBeInTheDocument();
  });

  it('shows create delivery button', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByRole('button', { name: /Nouvelle livraison/i })).toBeInTheDocument();
  });

  it('renders deliveries table with data', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Delivery 1')).toBeInTheDocument();
    expect(screen.getByText('Delivery 2')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.getByText('En cours')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Non assigné')).toBeInTheDocument();
  });

  it('filters deliveries by search term', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const searchInput = screen.getByPlaceholderText('Rechercher une livraison…');
    fireEvent.change(searchInput, { target: { value: 'Delivery 1' } });

    await waitFor(() => {
      expect(screen.getByText('Delivery 1')).toBeInTheDocument();
      expect(screen.queryByText('Delivery 2')).not.toBeInTheDocument();
    });
  });

  it('opens create drawer when clicking new delivery button', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    const buttons = screen.getAllByText('Nouvelle livraison');
    fireEvent.click(buttons[0]);

    expect(screen.getByText('Titre, adresses et chauffeur en une seule étape')).toBeInTheDocument();
  });

  it('shows empty state when no deliveries', async () => {
    const emptyData = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } };
    mockUseQuery.mockReturnValueOnce({ data: emptyData, isLoading: false });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).toBeNull();
    });

    expect(screen.getByText('Aucune livraison enregistrée')).toBeInTheDocument();
    expect(screen.getByText('Créez votre première livraison')).toBeInTheDocument();
  });

  it('shows skeleton loading state initially', async () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true });
    mockUseMutation.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

    renderPage();

    expect(screen.getByText('Livraisons')).toBeInTheDocument();
    expect(screen.getByText('Titre')).toBeInTheDocument();
    expect(screen.getByText('Statut')).toBeInTheDocument();
  });
});