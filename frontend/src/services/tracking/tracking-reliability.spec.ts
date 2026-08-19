import { describe, it, expect } from 'vitest';
import { enqueuePosition, queueSize, clearQueue, flushQueue, QUEUE_MAX_SIZE } from '../offlineQueue';
import 'fake-indexeddb/auto';

// =============================================================================
// FILE T DE SÉCURITÉ PERMANENT — invariants critiques du tracking côté app.
//
// Cette suite consolide les invariants transverses que les prompts précédents
// ont établis, pour qu'AUCUN futur changement de code ne puisse les casser
// silencieusement sans faire échouer la CI. Les scénarios BACKEND équivalents
// (coupure serveur Traccar + backfill, changement de chauffeur, getTripReport)
// sont couverts par : backend/src/modules/tracking/trip-fidelity.spec.ts,
// traccar-outage-recovery.spec.ts, traccar-backfill.spec.ts, tracking.gateway.spec.ts.
//
// Ici : le côté APP (ce qui protège les données AVANT l'envoi au backend).
// =============================================================================

describe('tracking-reliability — filet de sécurité côté app', () => {
  it('1. AUCUNE position dead-reckonnée n\'est envoyée au backend (le canal d\'envoi ne consomme que des fixes GPS bruts)', () => {
    // Vérification STRUCTURELLE : le module deadReckoning ne peut pas être
    // importé par les chemins d'envoi (useDriverTracking, offlineQueue,
    // TrackingContext). Seul RealTimeMap (affichage carte) l'importe.
    // Le test complet vit dans deadReckoning.spec.ts (scan de l'arbre src/).
    // Ici on ré-affirme le contrat minimal sans dépendre de l'arborescence.
    const { readdirSync, readFileSync } = require('fs');
    const { join } = require('path');
    const srcRoot = join(__dirname, '..', '..', '..', 'src');
    const walk = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) files.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.spec\./.test(e.name)) files.push(full);
      }
      return files;
    };
    const sendPathFiles = ['hooks/useDriverTracking.ts', 'services/offlineQueue.ts', 'services/tracking/backgroundLocation.ts'];
    for (const rel of sendPathFiles) {
      const content = readFileSync(join(srcRoot, rel), 'utf8');
      expect(content).not.toContain('deadReckoning');
      expect(content).not.toContain('predictPosition');
    }
  });

  it('2. Queue offline : coupure réseau → positions stockées SANS perte, purgées au retour réseau, dans l\'ordre chronologique', async () => {
    await clearQueue();
    // Coupure simulée : 5 positions capturées localement.
    for (let i = 0; i < 5; i++) {
      await enqueuePosition({
        latitude: -18.8792 + i * 0.001,
        longitude: 47.5079 + i * 0.001,
        timestamp: new Date(2026, 7, 15, 10, 0, i).toISOString(),
      });
    }
    expect(await queueSize()).toBe(5);

    // Retour réseau : purge intégrale, ordre FIFO conservé.
    let flushed: Array<Record<string, unknown>> = [];
    await flushQueue(async (positions) => {
      flushed = positions;
    });
    expect(flushed).toHaveLength(5);
    expect(await queueSize()).toBe(0);
    // Ordre chronologique : le premier capturé part en premier.
    const timestamps = flushed.map((p) => String(p.timestamp));
    expect(timestamps[0]).toBe(new Date(2026, 7, 15, 10, 0, 0).toISOString());
    expect(timestamps[4]).toBe(new Date(2026, 7, 15, 10, 0, 4).toISOString());
    await clearQueue();
  });

  it('3. Queue offline : une file pleine (> quota, entièrement récente) évince l\'ancien mais le SIGNALE (jamais de perte silencieuse)', async () => {
    await clearQueue();
    // Remplit la file au-delà du cap (éviction du plus ancien signalée).
    // (quota + 1) écritures IndexedDB séquentielles > 5s sous charge parallèle : timeout dédié.
    let lastResult: { queued: boolean; droppedOldest: boolean } | null = null;
    for (let i = 0; i < QUEUE_MAX_SIZE + 1; i++) {
      lastResult = await enqueuePosition({ index: i });
    }
    expect(lastResult?.queued).toBe(true);
    expect(lastResult?.droppedOldest).toBe(true);
    expect(await queueSize()).toBe(QUEUE_MAX_SIZE);
    await clearQueue();
  }, 60_000);

  it('4. La file offline est PERSISTANTE sur disque (IndexedDB) — une position en file survit à un kill de l\'app', () => {
    // Le stockage est IndexedDB (pas un Map en mémoire) : vérification statique du
    // fichier. Un futur refactor qui remplacerait IndexedDB par un état mémoire
    // casserait la persistance promettée (perte si l'app est tuée par l'OS).
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const content = readFileSync(join(__dirname, '..', 'offlineQueue.ts'), 'utf8');
    expect(content).toContain('indexedDB.open');
    expect(content).toContain('autoIncrement');
  });
});
