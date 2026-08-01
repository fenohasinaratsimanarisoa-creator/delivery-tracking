import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDataUpdates } from './useDataUpdates';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('../services/socket/socket', () => ({
  getSocket: () => mockSocket,
}));

function getDataUpdateHandler(): (event: { entity?: string; action?: string; id?: string }) => void {
  const call = mockSocket.on.mock.calls.find(([event]) => event === 'dataUpdate');
  if (!call) throw new Error('dataUpdate listener not registered');
  return call[1] as (event: { entity?: string; action?: string; id?: string }) => void;
}

describe('useDataUpdates', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
  });

  function renderHookInProvider() {
    return renderHook(() => useDataUpdates(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
  }

  it('registers a dataUpdate listener on the socket', () => {
    renderHookInProvider();
    expect(mockSocket.on).toHaveBeenCalledWith('dataUpdate', expect.any(Function));
  });

  it('invalidates fuel-daily-reports and fuel-consumption queries on a fuelReport event', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHookInProvider();

    getDataUpdateHandler()({ entity: 'fuelReport' });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['fuel-daily-reports'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['fuel-consumption'] });
  });

  it('does not invalidate fuel queries for other entity types', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHookInProvider();

    getDataUpdateHandler()({ entity: 'delivery' });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['deliveries'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['fuel-daily-reports'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['fuel-consumption'] });
  });

  it('still invalidates fuel queries for unknown ids on any fuelReport event', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHookInProvider();

    getDataUpdateHandler()({ entity: 'fuelReport', action: 'updated', id: 'driver-1' });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['fuel-daily-reports'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['fuel-consumption'] });
  });
});
