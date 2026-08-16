import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { enqueuePosition, flushQueue, queueSize, clearQueue, dequeuePositions } from './offlineQueue';

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

  it('handles maximum capacity of 5000 positions (≈4h offline)', async () => {
    // 5000 écritures IndexedDB séquentielles > 5s sous charge parallèle : timeout dédié.
    for (let i = 0; i < 5000; i++) {
      await enqueuePosition({ latitude: -18.87 + i * 0.001, index: i });
    }

    let size = await queueSize();
    expect(size).toBe(5000);

    await enqueuePosition({ latitude: -18.87, index: 5000 });

    size = await queueSize();
    expect(size).toBe(5000);
  }, 30_000);

  it('evicts oldest only beyond 5000, and signals it explicitly (droppedOldest=true — never silent)', async () => {
    for (let i = 0; i < 5000; i++) {
      await enqueuePosition({ index: i });
    }

    const result = await enqueuePosition({ index: 5000 });
    expect(result.queued).toBe(true);
    expect(result.droppedOldest).toBe(true);

    let flushed: any[] = [];
    await flushQueue(async (positions) => {
      flushed = positions;
    });

    expect(flushed).toHaveLength(5000);
    const flushedIndices = flushed.map((p) => p.index);
    expect(flushedIndices[0]).toBe(1);
    expect(flushedIndices[flushedIndices.length - 1]).toBe(5000);
    expect(flushedIndices).not.toContain(0);
  }, 30_000);

  it('does NOT evict below the 5000 cap (fidelity during realistic outages)', async () => {
    // 3000 positions ≈ 2h30 de coupure à la cadence 3s : AUCUNE perte, droppedOldest=false.
    for (let i = 0; i < 3000; i++) {
      const res = await enqueuePosition({ index: i });
      expect(res.droppedOldest).toBe(false);
    }
    const size = await queueSize();
    expect(size).toBe(3000);
  }, 30_000);

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
  });

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
  }, 30_000);

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
  }, 30_000);
});
