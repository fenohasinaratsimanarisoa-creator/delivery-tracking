import i18n from '../services/i18n/i18n';
import {
  LayoutDashboard, Truck, Users, MapPin, Fuel, FileText, Settings, UserCog,
  Package, Navigation, ClipboardList, Eye, Bell,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '../types';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  path: string;
  roles: Role[];
}

const allMenuItems: MenuItem[] = [
  { label: i18n.t('nav.dashboard'), icon: LayoutDashboard, path: '/dashboard', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.deliveries'), icon: Package, path: '/deliveries', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.fleet'), icon: Truck, path: '/vehicles', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.drivers'), icon: Users, path: '/drivers', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.map'), icon: MapPin, path: '/map', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.fuel'), icon: Fuel, path: '/fuel-consumption', roles: ['admin'] },
  { label: i18n.t('nav.reports'), icon: FileText, path: '/reports', roles: ['admin'] },
  { label: i18n.t('nav.users'), icon: UserCog, path: '/users', roles: ['admin'] },
  { label: i18n.t('nav.settings'), icon: Settings, path: '/settings', roles: ['admin'] },
  { label: i18n.t('nav.alerts'), icon: Bell, path: '/alerts', roles: ['admin', 'dispatcher'] },
  { label: i18n.t('nav.myDeliveries'), icon: ClipboardList, path: '/my-deliveries', roles: ['driver'] },
  { label: i18n.t('nav.myPosition'), icon: Navigation, path: '/my-position', roles: ['driver'] },
  { label: i18n.t('nav.myVehicle'), icon: Truck, path: '/my-vehicle', roles: ['driver'] },
  { label: i18n.t('nav.myOrders'), icon: Package, path: '/my-orders', roles: ['client'] },
  { label: i18n.t('nav.tracking'), icon: Eye, path: '/tracking', roles: ['client'] },
];

function getMenuItemsForRole(role: Role): MenuItem[] {
  return allMenuItems.filter((item) => item.roles.includes(role));
}

export { allMenuItems, getMenuItemsForRole };
export type { MenuItem, Role };
