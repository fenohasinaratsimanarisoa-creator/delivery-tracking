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
  // Émis par DeliveryProximityService (targetUserId → room driver, ET companyId
  // → room company via dataUpdate) : sans ce mapping, les alertes de proximité
  // apparaissaient mais les listes de livraisons associées restaient figées.
  proximityAlert: ['deliveries', 'my-deliveries', 'drivers'],
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

    const handleReconnect = () => {
      // Refetch all data on reconnect to catch missed events
      Object.values(QUERY_MAP).forEach((keys) => {
        keys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      });
    };

    socket.on('dataUpdate', handleUpdate);
    // Fonction nommée (pas une closure anonyme) : `getSocket()` renvoie un
    // singleton qui survit aux démontages, donc chaque montage de ce hook
    // (App.tsx en racine + MyDeliveriesPage.tsx à chaque navigation) empilait
    // un nouveau listener 'connect' jamais retiré — invalidations dupliquées
    // en boucle après plusieurs allers-retours sur la page.
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('dataUpdate', handleUpdate);
      socket.off('connect', handleReconnect);
    };
  }, [queryClient]);
}
