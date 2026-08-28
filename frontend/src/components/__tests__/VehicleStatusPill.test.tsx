import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VehicleStatusPill, { mapVehicleStatus } from '../VehicleStatusPill';

describe('VehicleStatusPill', () => {
  it('renders the i18n label for each status', () => {
    render(<VehicleStatusPill status="enroute" />);
    expect(screen.getByText('En route')).toBeInTheDocument();
  });

  it('shows an icon alongside the label (status not conveyed by colour alone)', () => {
    const { container } = render(<VehicleStatusPill status="offline" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Hors ligne')).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<VehicleStatusPill status="idle" label="Garé" />);
    expect(screen.getByText('Garé')).toBeInTheDocument();
  });

  it('iconOnly hides the text but keeps an accessible name', () => {
    render(<VehicleStatusPill status="alert" iconOnly />);
    expect(screen.queryByText('Alerte')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alerte')).toBeInTheDocument();
  });

  it('maps raw map-feed status to the semantic status', () => {
    expect(mapVehicleStatus('moving')).toBe('enroute');
    expect(mapVehicleStatus('static')).toBe('idle');
    expect(mapVehicleStatus('offline')).toBe('offline');
    expect(mapVehicleStatus('anything-else')).toBe('idle');
  });
});
