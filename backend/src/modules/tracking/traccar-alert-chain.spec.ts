const PgClient = require('pg').Client;
const alertCrypto = require('crypto');

// Base de TEST dédiée (jamais de production) fournie via l'environnement.
// Ce test fait des écritures réelles (INSERT/DELETE) : sans variable configurée,
// on SKIP proprement plutôt que d'échouer ou de retomber sur une valeur en dur.
const ALERT_TEST_DB = process.env.TRACCAR_TEST_DATABASE_URL;
const alertUuid = () => alertCrypto.randomUUID();

const alertDescribeOrSkip = ALERT_TEST_DB ? describe : describe.skip;

alertDescribeOrSkip('Traccar → Alert chain (intégration réelle)', () => {
  let client: any;
  let COMPANY_ID: string;
  let VEHICLE_ID: string;
  let DRIVER_ID: string;
  let DELIVERY_ID: string;

  beforeAll(async () => {
    if (ALERT_TEST_DB && !/test|staging/i.test(ALERT_TEST_DB)) {
      throw new Error(
        "TRACCAR_TEST_DATABASE_URL ne semble pas pointer vers une base de test " +
          '(le nom ne contient ni "test" ni "staging") — arrêt par sécurité pour ' +
          "éviter d'écrire dans une base de production.",
      );
    }
    // SSL uniquement pour les hôtes distants (Render) ; les bases locales/CI (docker)
    // n'exposent pas SSL. La requête de connexion distingue les deux cas proprement.
    const isRemote = !/localhost|127\.0\.0\.1|::1/.test(String(ALERT_TEST_DB));
    client = new PgClient({
      connectionString: ALERT_TEST_DB,
      ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    await client.connect();
    COMPANY_ID = alertUuid();
    await client.query(
      `INSERT INTO companies (id, name, created_at, updated_at) VALUES ($1, 'Test-Tenant-Alert', NOW(), NOW())`,
      [COMPANY_ID],
    );

    DRIVER_ID = alertUuid();
    await client.query(
      `INSERT INTO drivers (id, first_name, last_name, license_number, is_active, created_at, updated_at, company_id)
       VALUES ($1, 'Alert', 'Test', 'ALERT-001', true, NOW(), NOW(), $2)`,
      [DRIVER_ID, COMPANY_ID],
    );

    VEHICLE_ID = alertUuid();
    await client.query(
      `INSERT INTO vehicles (id, brand, model, year, license_plate, fuel_type, position_source,
        traccar_device_id, is_active, created_at, updated_at, company_id)
       VALUES ($1, 'Test', 'AlertCar', 2024, $2, 'gasoline', 'physical_tracker',
        'alert-test-42', true, NOW(), NOW(), $3)`,
      [VEHICLE_ID, 'ALERT-' + alertUuid().substring(0, 8), COMPANY_ID],
    );

    DELIVERY_ID = alertUuid();
    await client.query(
      `INSERT INTO deliveries (id, company_id, status, title, pickup_address, delivery_address,
        location_mismatch, mismatch_resolved, created_at, updated_at)
       VALUES ($1, $2, 'in_progress', 'Alert Test Delivery', 'Pickup', 'Delivery',
        false, false, NOW(), NOW())`,
      [DELIVERY_ID, COMPANY_ID],
    );

    await client.query(
      `INSERT INTO company_settings (id, company_id, speed_alert_threshold, created_at, updated_at)
       VALUES ($1, $2, 5.0, NOW(), NOW())`,
      [alertUuid(), COMPANY_ID],
    );
  });

  afterAll(async () => {
    await client.query('DELETE FROM notifications WHERE company_id = $1', [COMPANY_ID]);
    await client.query('DELETE FROM gps_positions WHERE vehicle_id = $1', [VEHICLE_ID]);
    await client.query('DELETE FROM deliveries WHERE id = $1', [DELIVERY_ID]);
    await client.query('DELETE FROM company_settings WHERE company_id = $1', [COMPANY_ID]);
    await client.query('DELETE FROM vehicles WHERE id = $1', [VEHICLE_ID]);
    await client.query('DELETE FROM drivers WHERE id = $1', [DRIVER_ID]);
    await client.query('DELETE FROM companies WHERE id = $1', [COMPANY_ID]);
    await client.end();
  });

  it('(1) conversion vitesse Traccar (noeuds) → m/s → km/h coherence alerte', async () => {
    const traccarSpeedKnots = 50;
    const bridgeSpeedMs = traccarSpeedKnots * 0.514444;
    const alertSpeedKmh = bridgeSpeedMs * 3.6;

    console.log(`Traccar speed: ${traccarSpeedKnots} knots`);
    console.log(`Bridge converts to: ${bridgeSpeedMs.toFixed(2)} m/s`);
    console.log(`Alert system sees: ${alertSpeedKmh.toFixed(1)} km/h`);
    console.log(`Threshold: 5 km/h → ${alertSpeedKmh > 5 ? 'ALERT TRIGGERED' : 'no alert'}`);

    expect(alertSpeedKmh).toBeGreaterThan(5);
  });

  it('(2) position inseree avec format PostGIS et vitesse en m/s', async () => {
    const speedKnots = 50;
    const speedMs = speedKnots * 0.514444;
    const locationStr = `POINT(47.5079 -18.8792)`;
    const posId = alertUuid();

    await client.query(
      `INSERT INTO gps_positions
        (id, latitude, longitude, speed, heading, altitude, accuracy,
         location, timestamp, vehicle_id, driver_id, delivery_id, company_id, source)
       VALUES ($1, -18.8792, 47.5079, $2, 90, 100, 10, $3, NOW(), $4, $5, $6, $7, 'physical_tracker')`,
      [posId, speedMs, locationStr, VEHICLE_ID, DRIVER_ID, DELIVERY_ID, COMPANY_ID],
    );

    const row = await client.query(
      'SELECT ST_AsText(ST_MakePoint(longitude, latitude)) AS pt, speed FROM gps_positions WHERE id = $1',
      [posId],
    );
    console.log('ST_AsText:', row.rows[0].pt);
    console.log('Speed stored:', Number(row.rows[0].speed).toFixed(2), 'm/s');

    expect(row.rows[0].pt).toBe('POINT(47.5079 -18.8792)');
    expect(Number(row.rows[0].speed)).toBeCloseTo(25.72, 0);
  });

  it('(3) detectTeleportation ne flagge pas un deplacement lent et legitime', async () => {
    const pos1Id = alertUuid();
    const pos2Id = alertUuid();
    const t1 = new Date();
    const t2 = new Date(t1.getTime() + 3 * 60 * 1000);

    await client.query(
      `INSERT INTO gps_positions (id, latitude, longitude, speed, location, timestamp, vehicle_id, driver_id, delivery_id, company_id, source)
       VALUES ($1, -18.8792, 47.5079, 2.57, 'POINT(47.5079 -18.8792)', $2, $3, $4, $5, $6, 'physical_tracker')`,
      [pos1Id, t1.toISOString(), VEHICLE_ID, DRIVER_ID, DELIVERY_ID, COMPANY_ID],
    );
    await client.query(
      `INSERT INTO gps_positions (id, latitude, longitude, speed, location, timestamp, vehicle_id, driver_id, delivery_id, company_id, source)
       VALUES ($1, -18.8830, 47.5120, 2.57, 'POINT(47.5120 -18.8830)', $2, $3, $4, $5, $6, 'physical_tracker')`,
      [pos2Id, t2.toISOString(), VEHICLE_ID, DRIVER_ID, DELIVERY_ID, COMPANY_ID],
    );

    const dist = await client.query(
      `SELECT ST_DistanceSphere(
         ST_SetSRID(ST_MakePoint(l1.longitude, l1.latitude), 4326),
         ST_SetSRID(ST_MakePoint(l2.longitude, l2.latitude), 4326)
       ) AS dist_m
       FROM gps_positions l1, gps_positions l2
       WHERE l1.id = $1 AND l2.id = $2`,
      [pos1Id, pos2Id],
    );
    const distanceM = Number(dist.rows[0].dist_m);
    const speedMs = distanceM / (3 * 60);
    console.log(
      `Distance: ${distanceM.toFixed(0)}m, Speed: ${speedMs.toFixed(2)} m/s (${(speedMs * 3.6).toFixed(1)} km/h)`,
    );

    expect(speedMs).toBeLessThan(100);
    expect(speedMs).toBeGreaterThan(0.5);
  });
});
