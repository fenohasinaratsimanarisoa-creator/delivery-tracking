import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MapPage from '../MapPage';

vi.mock('../../features/map/RealTimeMap', () => ({
  default: () => <div data-testid="real-time-map">RealTimeMap Component</div>,
}));

vi.mock('../../services/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { data: [] } }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

function renderMapPage() {
  return render(
    <MemoryRouter initialEntries={['/map']}>
      <Routes>
        <Route path="/map" element={<MapPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MapPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders full-screen map container', () => {
    renderMapPage();

    const mapContainer = screen.getByTestId('real-time-map');
    expect(mapContainer).toBeInTheDocument();
  });

  it('shows floating search bar', () => {
    renderMapPage();

    expect(screen.getByPlaceholderText('Rechercher un véhicule, un chauffeur, une livraison…')).toBeInTheDocument();
    expect(screen.getByLabelText('Rechercher sur la carte')).toBeInTheDocument();
  });

  it('has filter button', () => {
    renderMapPage();
    expect(screen.getByLabelText('Filtrer')).toBeInTheDocument();
  });

  it('shows layers button', () => {
    renderMapPage();

    const layersButton = screen.getByLabelText('Couches cartographiques');
    expect(layersButton).toBeInTheDocument();
  });

  it('shows bottom info bar with status indicators', () => {
    renderMapPage();

    expect(screen.getByText('En mouvement')).toBeInTheDocument();
    expect(screen.getByText("À l'arrêt")).toBeInTheDocument();
    expect(screen.getByText('Double-cliquez pour zoomer')).toBeInTheDocument();
  });

  it('filters update search state', () => {
    renderMapPage();

    const searchInput = screen.getByPlaceholderText('Rechercher un véhicule, un chauffeur, une livraison…');
    fireEvent.change(searchInput, { target: { value: 'Vehicle 123' } });

    expect(searchInput).toHaveValue('Vehicle 123');
  });

  it('has bottom legend', () => {
    renderMapPage();
    expect(screen.getByText('Double-cliquez pour zoomer')).toBeInTheDocument();
  });
});