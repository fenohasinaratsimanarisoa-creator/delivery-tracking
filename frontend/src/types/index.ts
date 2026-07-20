export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'dispatcher' | 'driver' | 'client';
  companyId: string;
}

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  licensePlate: string;
  fuelType: string;
  isActive: boolean;
}

export interface Delivery {
  id: string;
  title: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'delivered' | 'failed' | 'cancelled';
  pickupAddress: string;
  deliveryAddress: string;
  createdAt: string;
  vehicle?: Vehicle;
  driver?: { id: string; firstName: string; lastName: string };
}

export interface Position {
  id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  timestamp: string;
  deliveryId: string;
  vehicleId: string;
}
