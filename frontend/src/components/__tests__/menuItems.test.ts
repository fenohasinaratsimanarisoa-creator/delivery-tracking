import { describe, it, expect } from 'vitest';
import { getMenuItemsForRole, allMenuItems } from '../menuItems';

const mockT = (key: string): string => {
  const map: Record<string, string> = {
    'nav.dashboard': 'Dashboard',
    'nav.deliveries': 'Livraisons',
    'nav.fleet': 'Flotte',
    'nav.drivers': 'Chauffeurs',
    'nav.map': 'Carte temps réel',
    'nav.fuel': 'Carburant',
    'nav.reports': 'Rapports',
    'nav.users': 'Utilisateurs',
    'nav.settings': 'Paramètres',
    'nav.alerts': 'Alertes',
    'nav.deliveryProofs': 'Preuves de livraison',
    'nav.notifications': 'Notifications',
    'nav.myDeliveries': 'Mes livraisons',
    'nav.myVehicle': 'Mon véhicule',
    'nav.myOrders': 'Mes commandes',
    'nav.tracking': 'Suivi livraison',
  };
  return map[key] || key;
};

describe('getMenuItemsForRole', () => {
  it('admin has access to all admin items', () => {
    const items = getMenuItemsForRole('admin', mockT);
    expect(items.length).toBeGreaterThanOrEqual(9);
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Livraisons');
    expect(labels).toContain('Flotte');
    expect(labels).toContain('Chauffeurs');
    expect(labels).toContain('Carte temps réel');
    expect(labels).toContain('Carburant');
    expect(labels).toContain('Rapports');
    expect(labels).toContain('Utilisateurs');
    expect(labels).toContain('Paramètres');
    expect(labels).toContain('Alertes');
  });

  it('dispatcher has access to 8 items', () => {
    const items = getMenuItemsForRole('dispatcher', mockT);
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item.roles).toContain('dispatcher');
    }
  });

  it('driver has access to 4 items', () => {
    const items = getMenuItemsForRole('driver', mockT);
    expect(items).toHaveLength(4);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Alertes', 'Mes livraisons', 'Mon véhicule', 'Notifications']);
  });

  it('client has access to 3 items', () => {
    const items = getMenuItemsForRole('client', mockT);
    expect(items).toHaveLength(3);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Mes commandes', 'Suivi livraison', 'Notifications']);
  });

  it('every item in allMenuItems has at least one role', () => {
    for (const item of allMenuItems) {
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });

  it('no item has duplicate roles', () => {
    for (const item of allMenuItems) {
      const unique = new Set(item.roles);
      expect(unique.size).toBe(item.roles.length);
    }
  });
});
