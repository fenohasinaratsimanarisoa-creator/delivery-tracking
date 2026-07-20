import {
  LayoutDashboard, Truck, Users, MapPin, Fuel, FileText, Settings, UserCog,
  Package, Navigation, ClipboardList, Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Role = 'admin' | 'dispatcher' | 'driver' | 'client';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  path: string;
  roles: Role[];
}

const allMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ['admin', 'dispatcher'] },
  { label: 'Livraisons', icon: Package, path: '/deliveries', roles: ['admin', 'dispatcher'] },
  { label: 'Flotte', icon: Truck, path: '/vehicles', roles: ['admin', 'dispatcher'] },
  { label: 'Chauffeurs', icon: Users, path: '/drivers', roles: ['admin', 'dispatcher'] },
  { label: 'Carte temps réel', icon: MapPin, path: '/map', roles: ['admin', 'dispatcher'] },
  { label: 'Carburant', icon: Fuel, path: '/fuel-consumption', roles: ['admin'] },
  { label: 'Rapports', icon: FileText, path: '/reports', roles: ['admin'] },
  { label: 'Utilisateurs', icon: UserCog, path: '/users', roles: ['admin'] },
  { label: 'Paramètres', icon: Settings, path: '/settings', roles: ['admin'] },
  { label: 'Mes livraisons', icon: ClipboardList, path: '/my-deliveries', roles: ['driver'] },
  { label: 'Ma position', icon: Navigation, path: '/my-position', roles: ['driver'] },
  { label: 'Mon véhicule', icon: Truck, path: '/my-vehicle', roles: ['driver'] },
  { label: 'Mes commandes', icon: Package, path: '/my-orders', roles: ['client'] },
  { label: 'Suivi livraison', icon: Eye, path: '/tracking', roles: ['client'] },
];

function getMenuItemsForRole(role: Role): MenuItem[] {
  return allMenuItems.filter((item) => item.roles.includes(role));
}

export { allMenuItems, getMenuItemsForRole };
export type { MenuItem, Role };
