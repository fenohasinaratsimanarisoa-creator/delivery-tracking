import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  enqueuePosition,
  flushQueue,
  queueSize,
  clearQueue,
  dequeuePositions,
  QUEUE_MAX_SIZE,
  QUEUE_WARN_SIZE,
} from './offlineQueue';

beforeEach(async () => {
  await clearQueue();
});

describe('offlineQueue', () => {
  it('starts empty', async () => {
    const size = await queueSize();
    expect(size).toBe(0);
  });

  it('enqueues a position and returns correct size', async () => {
    await enqueuePosition({ latitude: -18.8792, longitude: 47.5079 });
    const size = await queueSize();
    expect(size).toBe(1);
  });

  it('maintains FIFO order', async () => {
    await enqueuePosition({ id: 'pos1', latitude: -18.8792 });
    await enqueuePosition({ id: 'pos2', latitude: -18.8800 });
    await enqueuePosition({ id: 'pos3', latitude: -18.8810 });

    let flushed: any[] = [];
    await flushQueue(async (positions) => {
      flushed = positions;
    });

    expect(flushed).toHaveLength(3);
    expect(flushed[0].id).toBe('pos1');
    expect(flushed[1].id).toBe('pos2');
    expect(flushed[2].id).toBe('pos3');
  });

  it('correctly purges queue after successful flush', async () => {
    await enqueuePosition({ latitude: -18.8792 });
    await enqueuePosition({ latitude: -18.8800 });

    await flushQueue(async (positions) => {
      expect(positions).toHaveLength(2);
    });

    const size = await queueSize();
    expect(size).toBe(0);
  });

  it('does not purge queue if flush function throws', async () => {
    await enqueuePosition({ latitude: -18.8792 });

    await expect(
      flushQueue(async () => {
        throw new Error('Network error');
      }),
    ).rejects.toThrow('Network error');

    const size = await queueSize();
    expect(size).toBe(1);
  });

  it(`handles maximum capacity of ${QUEUE_MAX_SIZE} positions (≈8h20 offline)`, async () => {
    // Écritures IndexedDB séquentielles lentes dans fake-indexeddb : timeout dédié.
    for (let i = 0; i < QUEUE_MAX_SIZE; i++) {
      await enqueuePosition({ latitude: -18.87 + i * 0.001, index: i });
    }

    let size = await queueSize();
    expect(size).toBe(QUEUE_MAX_SIZE);

    await enqueuePosition({ latitude: -18.87, index: QUEUE_MAX_SIZE });

    size = await queueSize();
    expect(size).toBe(QUEUE_MAX_SIZE);
  }, 90_000);

  it(`evicts oldest only beyond ${QUEUE_MAX_SIZE} (file entièrement récente → rien à compacter), and signals it explicitly (droppedOldest=true — never silent)`, async () => {
    for (let i = 0; i < QUEUE_MAX_SIZE; i++) {
      await enqueuePosition({ index: i });
    }

    const result = await enqueuePosition({ index: QUEUE_MAX_SIZE });
    expect(result.queued).toBe(true);
    expect(result.droppedOldest).toBe(true);

    // Lecture NON destructrice (pas de flush complet : l'éviction se vérifie
    // sans rejouer les 10000 positions).
    const flushed = await dequeuePositions(QUEUE_MAX_SIZE);
    expect(flushed).toHaveLength(QUEUE_MAX_SIZE);
    const flushedIndices = flushed.map((p) => p.index);
    expect(flushedIndices[0]).toBe(1);
    expect(flushedIndices[flushedIndices.length - 1]).toBe(QUEUE_MAX_SIZE);
    expect(flushedIndices).not.toContain(0);
    await clearQueue();
  }, 90_000);

  it('does NOT evict below the cap (fidelity during realistic outages)', async () => {
    // 3000 positions ≈ 2h30 de coupure à la cadence 3s : AUCUNE perte, droppedOldest=false.
    for (let i = 0; i < 3000; i++) {
      const res = await enqueuePosition({ index: i });
      expect(res.droppedOldest).toBe(false);
    }
    const size = await queueSize();
    expect(size).toBe(3000);
  }, 60_000);

  it(`signals nearCapacity early at ${QUEUE_WARN_SIZE} (80% of quota — option B), and clears below`, async () => {
    // En dessous du seuil : aucune alerte précoce.
    const small = await enqueuePosition({ index: 'small' });
    expect(small.nearCapacity).toBe(false);

    // Au seuil : nearCapacity=true dès la première position au-delà de 80 %.
    for (let i = 0; i < QUEUE_WARN_SIZE; i++) {
      await enqueuePosition({ index: i });
    }
    const atThreshold = await enqueuePosition({ index: 'threshold' });
    expect(atThreshold.queued).toBe(true);
    expect(atThreshold.nearCapacity).toBe(true);
    await clearQueue();
  }, 90_000);

  it('ne perd AUCUNE position sur une coupure simulée très longue (8 h 30, au-delà du quota) : compaction au lieu d\'éviction', async () => {
    // 10200 positions à cadence 3s = 8 h 30 de coupure, horodatées sur la
    // durée. Le quota (10000 ≈ 8 h 20) est dépassé : la stratégie doit
    // COMPACTER les anciennes (1 point / 45 s — résolution dégradée sur le
    // segment ancien, trace complète conservée) et ne JAMAIS signaler d'éviction.
    const STEP_MS = 3000;
    const COUNT = 10200;
    const startMs = Date.now() - (COUNT * STEP_MS);
    try {
      let dropped = 0;
      for (let i = 0; i < COUNT; i++) {
        const res = await enqueuePosition({
          index: i,
          timestamp: new Date(startMs + i * STEP_MS).toISOString(),
        });
        if (res.droppedOldest) dropped++;
      }
      // ZÉRO éviction dure : la compaction a absorbé le dépassement du quota.
      expect(dropped).toBe(0);

      let flushed: any[] = [];
      await flushQueue(async (positions) => {
        flushed = positions;
      });
      // La résolution a été dégradée (compaction) : moins de points que les
      // 10200 d'origine, mais AUCUNE position n'a été jetée sans représentante.
      expect(flushed.length).toBeLessThan(COUNT);
      expect(flushed.length).toBeGreaterThan(0);

      // Couverture chronologique COMPLÈTE du trajet : chaque tranche de 45 s de
      // la trace d'origine est représentée par au moins une position rejouée —
      // aucun trou dans l'historique, quelle que soit la durée de la coupure.
      const BUCKET_MS = 45 * 1000;
      const originalBuckets = new Set<number>();
      for (let i = 0; i < COUNT; i++) {
        originalBuckets.add(Math.floor((startMs + i * STEP_MS) / BUCKET_MS));
      }
      const flushedBuckets = new Set<number>();
      for (const p of flushed) {
        flushedBuckets.add(Math.floor(new Date(String(p.timestamp)).getTime() / BUCKET_MS));
      }
      let missingBuckets = 0;
      for (const bucketTs of originalBuckets) {
        if (!flushedBuckets.has(bucketTs)) missingBuckets++;
      }
      expect(missingBuckets).toBe(0);

      // Extrémités du trajet présentes (la plus ancienne ET la plus récente).
      const indices = flushed.map((p) => p.index as number).sort((a, b) => a - b);
      expect(indices[0]).toBe(0);
      expect(indices[indices.length - 1]).toBe(COUNT - 1);

      // Les tranches compactées sont marquées `compressed: true`.
      expect(flushed.filter((p) => p.compressed === true).length).toBeGreaterThan(0);
    } finally {
      // Nettoyage garanti MÊME en cas d'échec d'assertion : sans lui, la file
      // restante ralentit les tests suivants (contamination inter-tests).
      await clearQueue();
    }
  }, 180_000);

  it('handles concurrent enqueue and size check', async () => {
    await Promise.all([
      enqueuePosition({ latitude: 1 }),
      enqueuePosition({ latitude: 2 }),
      enqueuePosition({ latitude: 3 }),
    ]);

    const size = await queueSize();
    expect(size).toBe(3);
  });

  it('is idempotent for consecutive flush calls when queue is empty', async () => {
    await flushQueue(async () => {});
    await flushQueue(async () => {});
    const size = await queueSize();
    expect(size).toBe(0);
  }, 15_000);

  it('dequeuePositions returns at most N oldest positions in FIFO order without deleting them', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueuePosition({ index: i });
    }
    // Lecture NON destructrice : les N positions les plus anciennes (FIFO).
    const first = await dequeuePositions(2);
    expect(first.map((p) => p.index)).toEqual([0, 1]);
    expect(await queueSize()).toBe(5);
    // Tant que rien n'a été supprimé, les N plus anciennes restent les mêmes.
    expect(await dequeuePositions(3).then((p) => p.map((x) => x.index))).toEqual([0, 1, 2]);
    // limit ≥ taille de la file → toute la file.
    expect(await dequeuePositions(99).then((p) => p.map((x) => x.index))).toEqual([0, 1, 2, 3, 4]);
    await clearQueue();
  });

  it('flushQueue with chunkSize: 250 sends 3000+ positions in chunks of ≤250, each acked separately, emptying progressively', async () => {
    // Longue coupure réseau : plusieurs milliers de positions en file locale.
    for (let i = 0; i < 3000; i++) {
      await enqueuePosition({ index: i, latitude: -18.87 + i * 0.001 });
    }
    expect(await queueSize()).toBe(3000);

    const chunkSizes: number[] = [];
    const chunkIdRanges: Array<[number, number]> = [];
    let sent = 0;
    await flushQueue(async (positions) => {
      chunkSizes.push(positions.length);
      const idx = positions.map((p) => p.index as number);
      chunkIdRanges.push([Math.min(...idx), Math.max(...idx)]);
      sent += positions.length;
      // Simule l'ACK serveur (positionsSaved) : résolution = chunk acquitté.
    }, { chunkSize: 250 });

    // 3000 positions → 12 chunks de 250, AUCUN chunk > 250.
    expect(chunkSizes.length).toBe(12);
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(250);
    expect(chunkSizes).toEqual(Array(12).fill(250));
    expect(sent).toBe(3000);
    // File vidée à la fin (tout ou rien interdit : purge PAR chunk acquitté).
    expect(await queueSize()).toBe(0);
    // Ordre FIFO préservé d'un chunk à l'autre : aucun chevauchement, aucune
    // position réexpédiée ni oubliée.
    for (let c = 0; c < chunkIdRanges.length; c++) {
      const [lo, hi] = chunkIdRanges[c];
      expect(lo).toBe(c * 250);
      expect(hi).toBe(c * 250 + 249);
    }
    await clearQueue();
  }, 60_000);

  it('flushQueue never deletes positions whose send was NOT acked (chunk failing stops the loop, keeps the rest)', async () => {
    await clearQueue();
    for (let i = 0; i < 600; i++) {
      await enqueuePosition({ index: i });
    }
    let calls = 0;
    await expect(
      flushQueue(async (positions) => {
        calls++;
        expect(positions.length).toBeLessThanOrEqual(250);
        if (calls === 2) throw new Error('network down');
      }, { chunkSize: 250 }),
    ).rejects.toThrow('network down');

    // Chunk 1 (250) acquitté → purgé. Chunk 2 (250) ÉCHOUÉ → conservé, chunk 3
    // (100) jamais envoyé → conservé. Rien de non-acquitté n'est perdu.
    expect(calls).toBe(2);
    expect(await queueSize()).toBe(250 + 100);

    // Reprise au tick suivant : le drain suivant purge le reste.
    await flushQueue(async () => {});
    expect(await queueSize()).toBe(0);
    await clearQueue();
  }, 60_000);
});
