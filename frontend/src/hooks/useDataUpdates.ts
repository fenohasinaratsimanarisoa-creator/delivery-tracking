import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/socket/socket';

interface DataUpdateEvent {
  entity: string;
  action: string;
  id?: string;
}

const QUERY_MAP: Record<string, string[]> = {
  delivery: ['deliveries', 'alerts', 'delivery-proofs', 'my-deliveries'],
  driver: ['drivers', 'drivers', 'list'],
  vehicle: ['vehicles', 'vehicles', 'list'],
  alert: ['alerts', 'alerts-stats'],
  fuelReport: ['fuel-daily-reports', 'fuel-consumption'],
  geofence_event: ['geofences', 'alerts', 'deliveries'],
};

export function useDataUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleUpdate = (event: DataUpdateEvent) => {
      const keys = QUERY_MAP[event.entity];
      if (keys) {
        keys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      }
    };

    socket.on('dataUpdate', handleUpdate);
    socket.on('connect', () => {
      // Refetch all data on reconnect to catch missed events
      Object.values(QUERY_MAP).forEach((keys) => {
        keys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      });
    });

    return () => {
      socket.off('dataUpdate', handleUpdate);
    };
  }, [queryClient]);
}
