import { TrackingController } from './tracking.controller';

// =============================================================================
// Page « Santé du tracking » (audit A→Z 2026-09-24) : une moto garée dont le traceur GT06
// dort (plus de positions, mais paquets de veille reçus par Traccar) était affichée
// « SIGNAL PERDU » + « panne SIM/matériel ». Elle doit apparaître « en veille ».
// =============================================================================

const entry = (over: Record<string, unknown> = {}) => ({
  vehicleId: 'v1',
  source: 'physical_tracker',
  traccarDeviceId: '1',
  inSilence: true,
  trackerAsleep: false,
  thresholdMin: 15,
  probableSilenceCause: 'panne SIM/matériel',
  ...over,
});

const build = (silences: any[], contacts: Map<string, number> | null) => {
  const tracking = { getTrackingSilences: jest.fn().mockResolvedValue(silences) };
  const bridge = { getDeviceLastContacts: jest.fn().mockResolvedValue(contacts) };
  const ctrl = new TrackingController(tracking as any, {} as any, {} as any, bridge as any);
  return { ctrl, bridge };
};

describe('GET /tracking/silences — traceur en veille', () => {
  it('traceur silencieux mais contact Traccar il y a 1 min → en veille, cause rassurante', async () => {
    const { ctrl } = build([entry()], new Map([['1', Date.now() - 60_000]]));
    const [s] = await ctrl.getTrackingSilences('c1');
    expect(s.trackerAsleep).toBe(true);
    expect(s.probableSilenceCause).toMatch(/veille/);
  });

  it('plus aucun contact Traccar depuis > seuil → reste « signal perdu »', async () => {
    const { ctrl } = build([entry()], new Map([['1', Date.now() - 40 * 60_000]]));
    const [s] = await ctrl.getTrackingSilences('c1');
    expect(s.trackerAsleep).toBe(false);
    expect(s.probableSilenceCause).toBe('panne SIM/matériel');
  });

  it('Traccar indisponible → aucune modification', async () => {
    const { ctrl } = build([entry()], null);
    const [s] = await ctrl.getTrackingSilences('c1');
    expect(s.trackerAsleep).toBe(false);
  });

  it('aucun traceur en silence → Traccar non interrogé', async () => {
    const { ctrl, bridge } = build(
      [entry({ inSilence: false }), entry({ source: 'phone' })],
      new Map(),
    );
    await ctrl.getTrackingSilences('c1');
    expect(bridge.getDeviceLastContacts).not.toHaveBeenCalled();
  });
});
