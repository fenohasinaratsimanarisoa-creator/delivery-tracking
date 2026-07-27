import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { enqueuePosition, flushQueue, queueSize, clearQueue } from './offlineQueue';

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

  it('handles maximum capacity of 500 positions', async () => {
    for (let i = 0; i < 500; i++) {
      await enqueuePosition({ latitude: -18.87 + i * 0.001, index: i });
    }

    let size = await queueSize();
    expect(size).toBe(500);

    await enqueuePosition({ latitude: -18.87, index: 500 });

    size = await queueSize();
    expect(size).toBe(500);
  });

  it('drops oldest position when queue exceeds capacity (FIFO eviction)', async () => {
    for (let i = 0; i < 500; i++) {
      await enqueuePosition({ index: i });
    }

    await enqueuePosition({ index: 500 });

    let flushed: any[] = [];
    await flushQueue(async (positions) => {
      flushed = positions;
    });

    expect(flushed).toHaveLength(500);
    const flushedIndices = flushed.map((p) => p.index);
    expect(flushedIndices[0]).toBe(1);
    expect(flushedIndices[flushedIndices.length - 1]).toBe(500);
    expect(flushedIndices).not.toContain(0);
  });

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
});
