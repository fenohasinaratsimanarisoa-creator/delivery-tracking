import {
  LayoutDashboard, Truck, Users, MapPin, Fuel, FileText, Settings, UserCog,
  Package, ClipboardList, Eye, Bell, BellRing, CreditCard, Activity, Camera,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '../types';

type Section = 'overview' | 'operations' | 'fleet' | 'admin';

interface MenuItem {
  labelKey: string;
  icon: LucideIcon;
  path: string;
  roles: Role[];
  section: Section;
}

// Ordre du tableau = ordre d'affichage pour BottomNav et pour les rôles sous
// SECTION_THRESHOLD (driver/client) — inchangé par rapport à avant l'ajout des
// sections. Pour admin/dispatcher, getGroupedMenuItemsForRole reclasse par
// `section` indépendamment de cet ordre, donc il ne pilote que le mobile.
const allMenuItems: MenuItem[] = [
  { labelKey: 'nav.dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ['admin', 'dispatcher'], section: 'overview' },
  { labelKey: 'nav.deliveries', icon: Package, path: '/deliveries', roles: ['admin', 'dispatcher'], section: 'operations' },
  { labelKey: 'nav.fleet', icon: Truck, path: '/vehicles', roles: ['admin', 'dispatcher'], section: 'fleet' },
  { labelKey: 'nav.drivers', icon: Users, path: '/drivers', roles: ['admin', 'dispatcher'], section: 'fleet' },
  { labelKey: 'nav.map', icon: MapPin, path: '/map', roles: ['admin', 'dispatcher'], section: 'operations' },
  { labelKey: 'nav.fuel', icon: Fuel, path: '/fuel-consumption', roles: ['admin'], section: 'fleet' },
  { labelKey: 'nav.reports', icon: FileText, path: '/reports', roles: ['admin'], section: 'admin' },
  { labelKey: 'nav.users', icon: UserCog, path: '/users', roles: ['admin'], section: 'admin' },
  { labelKey: 'nav.settings', icon: Settings, path: '/settings', roles: ['admin'], section: 'admin' },
  { labelKey: 'nav.billing', icon: CreditCard, path: '/billing', roles: ['admin'], section: 'admin' },
  { labelKey: 'nav.alerts', icon: Bell, path: '/alerts', roles: ['admin', 'dispatcher', 'driver'], section: 'operations' },
  { labelKey: 'nav.trackingHealth', icon: Activity, path: '/tracking-health', roles: ['admin', 'dispatcher'], section: 'operations' },
  // Bell est déjà pris par Alertes/Notifications — Camera colle mieux à "preuves
  // de livraison" (photos horodatées) et évite deux entrées avec la même icône.
  { labelKey: 'nav.deliveryProofs', icon: Camera, path: '/delivery-proofs', roles: ['admin', 'dispatcher'], section: 'operations' },
  { labelKey: 'nav.myDeliveries', icon: ClipboardList, path: '/my-deliveries', roles: ['driver'], section: 'overview' },
  { labelKey: 'nav.myVehicle', icon: Truck, path: '/my-vehicle', roles: ['driver'], section: 'fleet' },
  { labelKey: 'nav.myOrders', icon: Package, path: '/my-orders', roles: ['client'], section: 'overview' },
  { labelKey: 'nav.tracking', icon: Eye, path: '/tracking', roles: ['client'], section: 'operations' },
  { labelKey: 'nav.notifications', icon: BellRing, path: '/notifications', roles: ['admin', 'dispatcher', 'driver', 'client'], section: 'operations' },
];

// En dessous de ce nombre total d'items pour un rôle donné (driver/client),
// des en-têtes de section ne font qu'ajouter du bruit visuel — on retombe
// sur une liste plate. Au-dessus (admin/dispatcher), le groupement est ce qui
// distingue un panneau de navigation "SaaS pro" d'une liste plate générique.
const SECTION_THRESHOLD = 6;

function getMenuItemsForRole(role: Role, t: (key: string) => string): (MenuItem & { label: string })[] {
  return allMenuItems
    .filter((item) => item.roles.includes(role))
    .map((item) => ({ ...item, label: t(item.labelKey) }));
}

function getGroupedMenuItemsForRole(role: Role, t: (key: string) => string) {
  const items = getMenuItemsForRole(role, t);
  if (items.length < SECTION_THRESHOLD) {
    return [{ section: null as Section | null, items }];
  }
  const order: Section[] = ['overview', 'operations', 'fleet', 'admin'];
  return order
    .map((section) => ({ section, items: items.filter((item) => item.section === section) }))
    .filter((group) => group.items.length > 0);
}

export { allMenuItems, getMenuItemsForRole, getGroupedMenuItemsForRole, SECTION_THRESHOLD };
export type { MenuItem, Role, Section };
