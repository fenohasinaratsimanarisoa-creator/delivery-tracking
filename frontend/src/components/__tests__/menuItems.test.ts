import { describe, it, expect } from 'vitest';
import { getMenuItemsForRole, allMenuItems } from '../menuItems';

describe('getMenuItemsForRole', () => {
  it('admin has access to all admin items', () => {
    const items = getMenuItemsForRole('admin');
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

  it('dispatcher has access to 6 items', () => {
    const items = getMenuItemsForRole('dispatcher');
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.roles).toContain('dispatcher');
    }
  });

  it('driver has access to 3 items', () => {
    const items = getMenuItemsForRole('driver');
    expect(items).toHaveLength(3);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Mes livraisons', 'Ma position', 'Mon véhicule']);
  });

  it('client has access to 2 items', () => {
    const items = getMenuItemsForRole('client');
    expect(items).toHaveLength(2);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Mes commandes', 'Suivi livraison']);
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
