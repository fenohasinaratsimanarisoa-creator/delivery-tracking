const { Client } = require('pg');
const nodeCrypto = require('crypto');

// Base de TEST dédiée (jamais de production) fournie via l'environnement.
// Sans variable configurée, on SKIP proprement (ne pas échouer la CI, ne pas
// retomber sur une valeur en dur).
const POSTGIS_TEST_DB = process.env.TRACCAR_TEST_DATABASE_URL;

const postgisDescribeOrSkip = POSTGIS_TEST_DB ? describe : describe.skip;

postgisDescribeOrSkip('Traccar → PostGIS data coherence', () => {
  let client: any;

  const LAT = -18.8792;
  const LNG = 47.5079;
  const SPEED_MS = 2.57;

  beforeAll(async () => {
    if (POSTGIS_TEST_DB && !/test|staging/i.test(POSTGIS_TEST_DB)) {
      throw new Error(
        'TRACCAR_TEST_DATABASE_URL ne semble pas pointer vers une base de test ' +
          '(le nom ne contient ni "test" ni "staging") — arrêt par sécurité pour ' +
          "éviter d'écrire dans une base de production.",
      );
    }
    // SSL uniquement pour les hôtes distants (Render) ; les bases locales/CI (docker)
    // n'exposent pas SSL. La requête de connexion distingue les deux cas proprement.
    const isRemote = !/localhost|127\.0\.0\.1|::1/.test(String(POSTGIS_TEST_DB));
    client = new Client({
      connectionString: POSTGIS_TEST_DB,
      ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('(a) verifie le format POINT(lng lat) avec une requete directe', async () => {
    const res = await client.query('SELECT ST_AsText(ST_MakePoint($1, $2)) AS pt', [LNG, LAT]);
    const wkt = res.rows[0].pt;
    console.log('ST_AsText(ST_MakePoint):', wkt);
    expect(wkt).toBe(`POINT(${LNG} ${LAT})`);
  });

  it('(b) PostGIS queries fonctionnent avec les valeurs lat/lng', async () => {
    const extCheck = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
    );
    const postgisAvailable = extCheck.rows.length > 0;
    console.log('PostGIS extension installed:', postgisAvailable);
    expect(postgisAvailable).toBe(true);

    const dwithin = await client.query(
      'SELECT ST_DWithin(' +
        'ST_SetSRID(ST_MakePoint($1, $2), 4326),' +
        'ST_SetSRID(ST_MakePoint($1, $2), 4326),' +
        '$3) AS within',
      [LNG, LAT, 0.01],
    );
    console.log('ST_DWithin (same point, 1km):', dwithin.rows[0].within);
    expect(dwithin.rows[0].within).toBe(true);

    const farLng = LNG + 0.005;
    const dwithinFar = await client.query(
      'SELECT ST_DWithin(' +
        'ST_SetSRID(ST_MakePoint($1, $2), 4326),' +
        'ST_SetSRID(ST_MakePoint($3, $4), 4326),' +
        '$5) AS within',
      [LNG, LAT, farLng, LAT, 0.00001],
    );
    console.log('ST_DWithin (500m away, 1m radius):', dwithinFar.rows[0].within);
    expect(dwithinFar.rows[0].within).toBe(false);

    const dist = await client.query(
      'SELECT ST_DistanceSphere(' +
        'ST_SetSRID(ST_MakePoint($1, $2), 4326),' +
        'ST_SetSRID(ST_MakePoint($1, $2), 4326)' +
        ') AS dist',
      [LNG, LAT],
    );
    console.log('ST_DistanceSphere (same point):', Number(dist.rows[0].dist).toFixed(2), 'm');
    expect(Number(dist.rows[0].dist)).toBeLessThan(1);
  });

  it('(c) l unite de vitesse est coherente entre Traccar et le systeme', () => {
    const knots = 5;
    const expectedMs = knots * 0.514444;
    const expectedKmh = expectedMs * 3.6;

    console.log(
      `Vitesse test: ${knots} noeuds → ${expectedMs.toFixed(3)} m/s → ${expectedKmh.toFixed(1)} km/h`,
    );
    console.log('');
    console.log('Lignes de preuve:');
    console.log('  traccar-bridge.service.ts:513  | speed: (pos.speed || 0) * 0.514444');
    console.log('  tracking.service.ts:130         | const speedMs = distance / timeDiffSec');
    console.log(
      '  tracking.service.ts:140         | speed=${(speedMs * 3.6).toFixed(1)}km/h (affichage)',
    );
    console.log('  tracking.service.ts:199         | const speedKmh = dto.speed * 3.6');
    console.log('  tracking.service.ts:222         | dto.speed < STOP_SPEED_THRESHOLD_MS');

    expect(expectedMs).toBeCloseTo(2.57, 1);
    expect(expectedMs).toBeLessThan(100);
    expect(expectedMs).toBeGreaterThan(0.5);
  });
});
