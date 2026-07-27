import {
  LayoutDashboard, Truck, Users, MapPin, Fuel, FileText, Settings, UserCog,
  Package, ClipboardList, Eye, Bell,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '../types';

interface MenuItem {
  labelKey: string;
  icon: LucideIcon;
  path: string;
  roles: Role[];
}

const allMenuItems: MenuItem[] = [
  { labelKey: 'nav.dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.deliveries', icon: Package, path: '/deliveries', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.fleet', icon: Truck, path: '/vehicles', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.drivers', icon: Users, path: '/drivers', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.map', icon: MapPin, path: '/map', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.fuel', icon: Fuel, path: '/fuel-consumption', roles: ['admin'] },
  { labelKey: 'nav.reports', icon: FileText, path: '/reports', roles: ['admin'] },
  { labelKey: 'nav.users', icon: UserCog, path: '/users', roles: ['admin'] },
  { labelKey: 'nav.settings', icon: Settings, path: '/settings', roles: ['admin'] },
  { labelKey: 'nav.alerts', icon: Bell, path: '/alerts', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.deliveryProofs', icon: Bell, path: '/delivery-proofs', roles: ['admin', 'dispatcher'] },
  { labelKey: 'nav.myDeliveries', icon: ClipboardList, path: '/my-deliveries', roles: ['driver'] },
  { labelKey: 'nav.myVehicle', icon: Truck, path: '/my-vehicle', roles: ['driver'] },
  { labelKey: 'nav.myOrders', icon: Package, path: '/my-orders', roles: ['client'] },
  { labelKey: 'nav.tracking', icon: Eye, path: '/tracking', roles: ['client'] },
];

function getMenuItemsForRole(role: Role, t: (key: string) => string): (MenuItem & { label: string })[] {
  return allMenuItems
    .filter((item) => item.roles.includes(role))
    .map((item) => ({ ...item, label: t(item.labelKey) }));
}

export { allMenuItems, getMenuItemsForRole };
export type { MenuItem, Role };
