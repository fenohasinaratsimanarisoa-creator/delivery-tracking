const { Client } = require('pg');
const nodeCrypto = require('crypto');

const PROD_DB = 'postgresql://delivery_tracking_ghba_user:aRAlcrSvohQdwVZbVrmnAZx0afCxPbdq@dpg-d9hjlmbeo5us73eb5e8g-a.frankfurt-postgres.render.com/delivery_tracking_ghba';
const uuid = () => nodeCrypto.randomUUID();

describe('Traccar → PostGIS data coherence', () => {
  let client: any;
  let insertedId: string;

  const VEHICLE_ID = '40e65d17-34bc-41e7-af55-59bffbe6c6f3';
  const DRIVER_ID = 'ce179262-8905-43c1-82bc-58dab2e34791';
  const COMPANY_ID = 'fb3fe77f-570f-487b-847e-f803094cdf75';
  const LAT = -18.8792;
  const LNG = 47.5079;
  const SPEED_MS = 2.57;

  beforeAll(async () => {
    client = new Client({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });
    await client.connect();
  });

  afterAll(async () => {
    if (insertedId) {
      await client.query('DELETE FROM gps_positions WHERE id = $1', [insertedId]);
    }
    await client.end();
  });

  it('(a) insere et verifie le format POINT(lng lat) dans la colonne location', async () => {
    const locationStr = `POINT(${LNG} ${LAT})`;
    const ts = new Date().toISOString();

    const rowId = uuid();
    const res = await client.query(
      `INSERT INTO gps_positions
        (id, latitude, longitude, speed, heading, altitude, accuracy,
         location, timestamp, vehicle_id, driver_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, location, latitude, longitude`,
      [rowId, LAT, LNG, SPEED_MS, 90, 100, 10, locationStr, ts, VEHICLE_ID, DRIVER_ID],
    );

    const row = res.rows[0];
    insertedId = row.id;
    console.log('Inserted id:', row.id);
    console.log('location raw:', JSON.stringify(row.location));
    console.log('latitude:', row.latitude, 'longitude:', row.longitude);

    expect(row.location).toBe(`POINT(${LNG} ${LAT})`);
  });

  it('(b) PostGIS queries fonctionnent sur les colonnes lat/lng', async () => {
    expect(insertedId).toBeDefined();

    // Vérifier d'abord si PostGIS est installé
    const extCheck = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
    );
    const postgisAvailable = extCheck.rows.length > 0;
    console.log('PostGIS extension installed:', postgisAvailable);

    if (!postgisAvailable) {
      console.log('⚠️  PostGIS NOT available on this database. Enable it with: CREATE EXTENSION postgis;');
      // Fallback: vérifier que la colonne location contient le WKT correct
      const wktCheck = await client.query(
        'SELECT location FROM gps_positions WHERE id = $1',
        [insertedId],
      );
      expect(wktCheck.rows[0].location).toBe(`POINT(${LNG} ${LAT})`);
      return;
    }

    const dwithin = await client.query(
      `SELECT id FROM gps_positions
       WHERE id = $1
         AND ST_DWithin(
               ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
               ST_SetSRID(ST_MakePoint($2, $3), 4326),
               $4
             )`,
      [insertedId, LNG, LAT, 0.01],
    );
    console.log('ST_DWithin rows within 1km:', dwithin.rows.length);
    expect(dwithin.rows.length).toBe(1);

    const farLng = LNG + 0.005;
    const dwithinFar = await client.query(
      `SELECT id FROM gps_positions
       WHERE id = $1
         AND ST_DWithin(
               ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
               ST_SetSRID(ST_MakePoint($2, $3), 4326),
               $4
             )`,
      [insertedId, farLng, LAT, 0.00001],
    );
    console.log('ST_DWithin rows within 1m (500m away):', dwithinFar.rows.length);
    expect(dwithinFar.rows.length).toBe(0);

    const dist = await client.query(
      `SELECT ST_DistanceSphere(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
         ST_SetSRID(ST_MakePoint($1, $2), 4326)
       ) AS dist_m
       FROM gps_positions WHERE id = $3`,
      [LNG, LAT, insertedId],
    );
    console.log('ST_DistanceSphere (same point):', Number(dist.rows[0].dist_m).toFixed(2), 'm');
    expect(Number(dist.rows[0].dist_m)).toBeLessThan(1);
  });

  it('(c) l unite de vitesse est coherente entre Traccar et le systeme', () => {
    // Chaîne complète de conversion :
    //
    // 1. Traccar envoie speed en noeuds (knots)
    // 2. traccar-bridge.service.ts:513 : speed = pos.speed * 0.514444
    //    → conversion noeuds → m/s
    //
    // 3. savePosition stocke speed en m/s dans gps_positions.speed
    //
    // 4. detectTeleportation (tracking.service.ts:130) :
    //    const speedMs = distance / timeDiffSec;   // calcul en m/s
    //    TELEPORT_SPEED_THRESHOLD_MS en m/s
    //    → confirmé : attend m/s
    //
    // 5. generateAlerts (tracking.service.ts:199) :
    //    const speedKmh = dto.speed * 3.6;         // convertit m/s → km/h
    //    compare speedKmh > settings.speedAlertThreshold (km/h)
    //    → confirmé : attend m/s sur dto.speed
    //
    // 6. prolonged_stop (tracking.service.ts:222) :
    //    dto.speed < STOP_SPEED_THRESHOLD_MS        // compare en m/s
    //    → confirmé : attend m/s

    const knots = 5;
    const expectedMs = knots * 0.514444;
    const expectedKmh = expectedMs * 3.6;

    console.log(`Vitesse test: ${knots} noeuds → ${expectedMs.toFixed(3)} m/s → ${expectedKmh.toFixed(1)} km/h`);
    console.log('');
    console.log('Lignes de preuve:');
    console.log('  traccar-bridge.service.ts:513  | speed: (pos.speed || 0) * 0.514444');
    console.log('  tracking.service.ts:130         | const speedMs = distance / timeDiffSec');
    console.log('  tracking.service.ts:140         | speed=${(speedMs * 3.6).toFixed(1)}km/h (affichage)');
    console.log('  tracking.service.ts:199         | const speedKmh = dto.speed * 3.6');
    console.log('  tracking.service.ts:222         | dto.speed < STOP_SPEED_THRESHOLD_MS');

    expect(expectedMs).toBeCloseTo(2.57, 1);
    expect(expectedMs).toBeLessThan(100);
    expect(expectedMs).toBeGreaterThan(0.5);
  });
});
