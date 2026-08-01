import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FuelPage from '../FuelPage';

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

describe('FuelPage', () => {
  const mockEntries = [
    {
      id: 'fuel-1',
      vehicleId: 'veh-1',
      vehicle: { id: 'veh-1', licensePlate: 'AB-123-CD' },
      liters: 50,
      kilometers: 400,
      cost: 245000,
      fillDate: '2026-07-20T10:00:00.000Z',
      notes: null,
      anomalyFlag: false,
      calculatedConsumption: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'fuel-daily-reports') {
        return { data: [], isLoading: false };
      }
      if (queryKey[0] === 'fuel-prices') {
        return { data: { defaults: { diesel: 5200 }, history: [] }, isLoading: false };
      }
      if (queryKey[0] === 'vehicles') {
        return { data: [{ id: 'veh-1', brand: 'Toyota', model: 'Hilux', licensePlate: 'AB-123-CD' }], isLoading: false };
      }
      return { data: { data: mockEntries, meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, isLoading: false };
    });
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false });
  });

  it('renders the manual entry table and the new fuel log button', async () => {
    render(<FuelPage />);

    expect(screen.getByText('AB-123-CD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau plein' })).toBeInTheDocument();
  });

  it('opens the create dialog when clicking "Nouveau plein"', async () => {
    render(<FuelPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Nouveau plein' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Ajouter un relevé' })).toBeInTheDocument();
    });
  });

  it('renders the fuel prices tab with editable default prices', async () => {
    render(<FuelPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Prix carburant' }));

    await waitFor(() => {
      expect(screen.getByText('Prix par défaut (par type de carburant)')).toBeInTheDocument();
    });
    expect(screen.getByText('Enregistrer les prix par défaut')).toBeInTheDocument();
    expect(screen.getByText('Diesel')).toBeInTheDocument();
  });
});
