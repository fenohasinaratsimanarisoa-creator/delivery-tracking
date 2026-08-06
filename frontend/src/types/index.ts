export type Role = 'admin' | 'dispatcher' | 'driver' | 'client';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  companyId: string;
}

export interface AppUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  phone?: string;
  createdAt: string;
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  isActive: boolean;
  vehicleId?: string | null;
  vehicle?: { id: string; brand: string; model: string; licensePlate: string } | null;
}

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  licensePlate: string;
  fuelType: string;
  isActive: boolean;
  positionSource?: string;
  traccarDeviceId?: string | null;
  driver?: { id: string; firstName: string; lastName: string } | null;
}

export interface VehicleListItem {
  id: string;
  brand: string;
  model: string;
  licensePlate: string;
  fuelType: string;
  driver: { id: string } | null;
}

export interface Delivery {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'delivered' | 'failed' | 'cancelled';
  pickupAddress: string;
  deliveryAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  pickupLocationLabel?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryLocationLabel?: string;
  scheduledDate?: string;
  notes?: string;
  driverId?: string;
  vehicleId?: string;
  createdAt: string;
  vehicle?: Vehicle;
  driver?: { id: string; firstName: string; lastName: string };
  deliveryProofLat?: number;
  deliveryProofLng?: number;
  deliveryProofDistance?: number;
  deliveryProofAccuracy?: number;
  locationMismatch?: boolean;
  mismatchResolved?: boolean;
  clientPhone?: string;
  amount?: number;
  articlePrice?: number;
  productDescription?: string;
  externalOrderRef?: string;
}

export interface Position {
  id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  timestamp: string;
  deliveryId: string;
  vehicleId: string;
  driverId?: string;
  driverName?: string;
}

export interface Notification {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
}

export interface FuelLog {
  id: string;
  liters: number;
  kilometers: number;
  cost: number;
  fillDate: string;
  anomalyFlag: boolean;
  anomalyReason?: string | null;
  consumptionAnomalyFlag?: boolean;
  consumptionAnomalyReason?: string | null;
  // Sens de l'écart de consommation (over = sur-consommation, under = sous-consommation),
  // renseigné quand consumptionAnomalyFlag=true. Permet d'afficher la direction sans
  // parser le texte du message.
  consumptionDeviationDirection?: 'over' | 'under' | null;
  gpsAnomalyFlag?: boolean;
  gpsAnomalyReason?: string | null;
  // Couverture GPS insuffisante : signal distinct d'une anomalie confirmée (« non
  // vérifiable »), exposé séparément par withDerivedAnomaly (jamais fusionné dans
  // anomalyFlag) pour un affichage neutre côté frontend.
  gpsCoverageInsufficientFlag?: boolean;
  gpsCoverageInsufficientReason?: string | null;
  calculatedConsumption: number | null;
  notes?: string;
  vehicleId?: string;
  vehicle: { id?: string; licensePlate: string };
}

export interface DeliveryInfo {
  id: string;
  title: string;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
}

export interface DeliveryStat {
  status: string;
  count: number;
}

export interface FuelChartPoint {
  date: string;
  consumption: number;
  vehicle: string;
  anomaly: boolean;
}

export interface BillingPlan {
  id: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  name: string;
  description?: string;
  price: number;
  currency: string;
  interval: string;
  maxVehicles: number;
  maxDeliveriesPerMonth: number;
  maxUsers: number;
  features: string[];
}

export interface Subscription {
  id: string;
  companyId: string;
  planId: string;
  plan: BillingPlan;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'unpaid' | 'trialing';
  provider: 'stripe' | 'mvola' | 'orange_money';
  currentPeriodEnd: string;
  currentPeriodStart: string;
  canceledAt?: string;
  invoices: Invoice[];
}

export interface Invoice {
  id: string;
  companyId: string;
  subscriptionId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  provider: string;
  paidAt?: string;
  createdAt: string;
  subscription?: Subscription;
}

export interface CompanyUsage {
  deliveriesUsed: number;
  deliveriesLimit: number;
  vehiclesUsed: number;
  vehiclesLimit: number;
  usersUsed: number;
  usersLimit: number;
  plan: { name: string; tier: string };
}

export interface Kpis {
  deliveriesToday: number;
  totalDeliveries: number;
  activeVehicles: number;
  activeDrivers: number;
  anomalies: number;
  fuelStats: {
    totalLiters: number;
    totalKilometers: number;
    averageConsumption: number;
  };
}
