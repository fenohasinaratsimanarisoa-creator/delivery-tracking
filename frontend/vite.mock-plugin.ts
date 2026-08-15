/**
 * Mock API — UNIQUEMENT pour la vérification visuelle en dev (jamais en prod).
 * Activé via `vite.mock.config.ts` (VITE_ENABLE_MOCKS=1). Répond aux endpoints
 * consommés par le Dashboard (admin) et l'app chauffeur (driver) avec des
 * fixtures réalistes, pour rendre les écrans sans backend/Redis.
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const DAY = 24 * 3600 * 1000;

const nowIso = (offsetHours = 0) => new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
const dayIso = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const VEHICLES = [
  { id: 'v-1', brand: 'Toyota', model: 'Hilux', licensePlate: '1234 TBA', year: 2021, fuelType: 'Diesel', status: 'active' },
  { id: 'v-2', brand: 'Mitsubishi', model: 'L200', licensePlate: '5678 TBE', year: 2020, fuelType: 'Diesel', status: 'active' },
  { id: 'v-3', brand: 'Peugeot', model: 'Partner', licensePlate: '9012 TBF', year: 2022, fuelType: 'Diesel', status: 'active' },
  { id: 'v-4', brand: 'Kia', model: 'K2700', licensePlate: '3456 TBC', year: 2019, fuelType: 'Diesel', status: 'active' },
  { id: 'v-5', brand: 'Isuzu', model: 'D-Max', licensePlate: '7890 TBD', year: 2023, fuelType: 'Diesel', status: 'maintenance' },
  { id: 'v-6', brand: 'Renault', model: 'Kangoo', licensePlate: '2345 TBB', year: 2021, fuelType: 'Essence', status: 'active' },
];

const DRIVERS = [
  { id: 'd-1', firstName: 'Mamy', lastName: 'Razafy', licenseNumber: 'LIC-0012', phone: '+261 34 12 345 67', status: 'active', vehicleId: 'v-1' },
  { id: 'd-2', firstName: 'Lova', lastName: 'Andriana', licenseNumber: 'LIC-0087', phone: '+261 33 98 765 43', status: 'active', vehicleId: 'v-2' },
  { id: 'd-3', firstName: 'Nirina', lastName: 'Rakotondrabe', licenseNumber: 'LIC-0044', phone: '+261 32 55 443 21', status: 'active', vehicleId: 'v-3' },
  { id: 'd-4', firstName: 'Feno', lastName: 'Randria', licenseNumber: 'LIC-0099', phone: '+261 34 77 112 23', status: 'active', vehicleId: 'v-4' },
  { id: 'd-5', firstName: 'Tiana', lastName: 'Ravelojaona', licenseNumber: 'LIC-0031', phone: '+261 33 66 009 87', status: 'inactive', vehicleId: 'v-5' },
  { id: 'd-6', firstName: 'Zo', lastName: 'Rasolofonirina', licenseNumber: 'LIC-0077', phone: '+261 32 44 556 78', status: 'active', vehicleId: 'v-6' },
];

const driverName = (id: string) => {
  const d = DRIVERS.find((x) => x.id === id);
  return d ? `${d.firstName} ${d.lastName}` : 'Véhicule sans chauffeur assigné';
};

// Positions GPS autour d'Antananarivo (-18.8792, 47.5079)
const LIVE_POSITIONS = [
  { vehicleId: 'v-1', driverName: driverName('d-1'), latitude: -18.8792, longitude: 47.5079, speed: 11.4, heading: 214, accuracy: 6, timestamp: nowIso(), minutesAgo: 0 },
  { vehicleId: 'v-2', driverName: driverName('d-2'), latitude: -18.9023, longitude: 47.5315, speed: 0, heading: 90, accuracy: 8, timestamp: nowIso(-0.02), minutesAgo: 1 },
  { vehicleId: 'v-3', driverName: driverName('d-3'), latitude: -18.8651, longitude: 47.4722, speed: 8.7, heading: 12, accuracy: 5, timestamp: nowIso(), minutesAgo: 0 },
  { vehicleId: 'v-4', driverName: driverName('d-4'), latitude: -18.9117, longitude: 47.5534, speed: 0, heading: 180, accuracy: 12, timestamp: nowIso(-0.05), minutesAgo: 3 },
  { vehicleId: 'v-6', driverName: driverName('d-6'), latitude: -18.8498, longitude: 47.4889, speed: 15.2, heading: 300, accuracy: 9, timestamp: nowIso(), minutesAgo: 0 },
];

const DELIVERIES = [
  {
    id: 'dlv-1', title: 'Livraison Analakely — Cotonou Fashion', status: 'in_progress',
    pickupAddress: 'Entrepôt Ankorondrano, Antananarivo', deliveryAddress: 'Rue Rainilaiarivony, Analakely, Antananarivo',
    pickupLat: -18.8977, pickupLng: 47.5115, deliveryLat: -18.9096, deliveryLng: 47.5239,
    scheduledDate: dayIso(0), createdAt: nowIso(-1.5), notes: 'Appeler le client 15 min avant l\'arrivée.',
    vehicle: VEHICLES[0], driver: { id: 'd-1', firstName: 'Mamy', lastName: 'Razafy' },
  },
  {
    id: 'dlv-2', title: 'Livraison Ivato — Teknika SARL', status: 'assigned',
    pickupAddress: 'Dépôt Ivato Aéroport', deliveryAddress: 'Zone industrielle Ivato, Antananarivo',
    scheduledDate: dayIso(0), createdAt: nowIso(-3),
    vehicle: VEHICLES[1], driver: { id: 'd-2', firstName: 'Lova', lastName: 'Andriana' },
  },
  {
    id: 'dlv-3', title: 'Livraison Ambohimanarina — Pharma Plus', status: 'assigned',
    pickupAddress: 'Entrepôt Ankorondrano', deliveryAddress: 'Lot II A 45, Ambohimanarina, Antananarivo',
    scheduledDate: dayIso(1), createdAt: nowIso(-5),
    vehicle: VEHICLES[2], driver: { id: 'd-3', firstName: 'Nirina', lastName: 'Rakotondrabe' },
  },
  {
    id: 'dlv-4', title: 'Livraison Mahamasina — Boutique Solaire', status: 'delivered',
    pickupAddress: 'Dépôt Ivato Aéroport', deliveryAddress: 'Mahamasina, Antananarivo',
    scheduledDate: dayIso(-1), createdAt: nowIso(-26), notes: 'Colis fragile — manipuler avec précaution.',
    vehicle: VEHICLES[3], driver: { id: 'd-4', firstName: 'Feno', lastName: 'Randria' },
  },
  {
    id: 'dlv-5', title: 'Livraison Ambodivona — Groupe Tiko', status: 'delivered',
    pickupAddress: 'Entrepôt Ankorondrano', deliveryAddress: 'Ambodivona, Antananarivo',
    scheduledDate: dayIso(-2), createdAt: nowIso(-50),
    vehicle: VEHICLES[5], driver: { id: 'd-6', firstName: 'Zo', lastName: 'Rasolofonirina' },
  },
  {
    id: 'dlv-6', title: 'Livraison Isotry — Supermarché Score', status: 'failed',
    pickupAddress: 'Dépôt Ivato Aéroport', deliveryAddress: 'Isotry, Antananarivo',
    scheduledDate: dayIso(-1), createdAt: nowIso(-30), notes: 'Client absent — tentative à 15h30.',
    vehicle: VEHICLES[0], driver: { id: 'd-1', firstName: 'Mamy', lastName: 'Razafy' },
  },
];

export default function mockApiPlugin(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse, next) => {
        const path = (req.url || '/').replace(/^\/api/, '').split('?')[0];
        const method = (req.method || 'GET').toUpperCase();
        const q = (req.url || '').split('?')[1] || '';
        const param = (k: string) => new URLSearchParams(q).get(k);

        // ── Auth (le flux ?token= évite le login ; refresh volontairement 401) ──
        if (path === '/auth/csrf-token' && method === 'GET') return send(res, 200, { csrfToken: 'mock-token', csrfHmac: 'mock-hmac' });
        if (path === '/auth/refresh' && method === 'POST') return send(res, 401, { message: 'Unauthorized (mock)' });
        if (path === '/auth/logout' && method === 'POST') return send(res, 200, { success: true });

        // ── Dashboard ──
        if (path === '/dashboard/kpis' && method === 'GET') {
          return send(res, 200, {
            deliveriesToday: 12,
            totalDeliveries: 342,
            activeVehicles: 5,
            activeDrivers: 4,
            anomalies: 2,
            fuelStats: { totalLiters: 812.4, totalKilometers: 5120, averageConsumption: 8.4 },
          });
        }
        if (path === '/dashboard/delivery-stats' && method === 'GET') {
          return send(res, 200, [
            { status: 'pending', count: 3 },
            { status: 'assigned', count: 4 },
            { status: 'in_progress', count: 5 },
            { status: 'delivered', count: 18 },
            { status: 'failed', count: 1 },
            { status: 'cancelled', count: 1 },
          ]);
        }
        if (path === '/dashboard/fuel-chart' && method === 'GET') {
          return send(res, 200, [
            { date: dayIso(-6), consumption: 8.9, vehicle: 'Tous', anomaly: false },
            { date: dayIso(-5), consumption: 9.4, vehicle: 'Tous', anomaly: false },
            { date: dayIso(-4), consumption: 7.8, vehicle: 'Tous', anomaly: false },
            { date: dayIso(-3), consumption: 12.1, vehicle: 'Tous', anomaly: true },
            { date: dayIso(-2), consumption: 8.2, vehicle: 'Tous', anomaly: false },
            { date: dayIso(-1), consumption: 8.0, vehicle: 'Tous', anomaly: false },
            { date: dayIso(0), consumption: 8.4, vehicle: 'Tous', anomaly: false },
          ]);
        }
        if (path === '/dashboard/reliability-score' && method === 'GET') {
          return send(res, 200, { score: 96, trend: 'up' });
        }
        if (path === '/onboarding/status' && method === 'GET') {
          return send(res, 200, {
            add_vehicle: true,
            invite_driver: true,
            create_delivery: true,
            configure_notifications: true,
          });
        }

        // ── Livraisons ──
        if (path === '/deliveries' && method === 'GET' && param('limit')) {
          const data = DELIVERIES.slice(0, 5).map((d) => ({ id: d.id, title: d.title, status: d.status }));
          return send(res, 200, { data, meta: { total: 32, page: 1, limit: 5 } });
        }
        if (path === '/deliveries/my-deliveries' && method === 'GET') {
          return send(res, 200, { data: DELIVERIES });
        }

        // ── Tracking / carte temps réel ──
        if (path === '/tracking/live' && method === 'GET') {
          return send(res, 200, LIVE_POSITIONS);
        }

        // ── Chauffeurs / véhicules ──
        if (path === '/drivers' && method === 'GET') {
          return send(res, 200, {
            data: DRIVERS.map((d) => ({ ...d, vehicle: VEHICLES.find((v) => v.id === d.vehicleId) })),
            meta: { total: DRIVERS.length, page: 1, limit: 100 },
          });
        }
        if (path === '/drivers/profile' && method === 'GET') {
          const d = DRIVERS[0];
          return send(res, 200, { ...d, vehicle: VEHICLES.find((v) => v.id === d.vehicleId) });
        }

        return send(res, 404, { message: `Mock: endpoint inconnu ${method} ${path}` });
      });
    },
  };
}
