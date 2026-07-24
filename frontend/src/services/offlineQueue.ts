const DB_NAME = 'delivery-tracking';
const STORE_NAME = 'position-queue';
const DB_VERSION = 1;

const QUEUE_MAX_SIZE = 500;
const LATENCY_THRESHOLD_MS = 3000;

let isFlushing = false;
let lastLatencyCheck = 0;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function checkLatency(): Promise<number> {
  const start = Date.now();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = resolve;
      req.onerror = reject;
    });
    return Date.now() - start;
  } catch {
    return Infinity;
  }
}

export function shouldQueueDueToLatency(): Promise<boolean> {
  const now = Date.now();
  if (now - lastLatencyCheck < 10000) return Promise.resolve(false);
  lastLatencyCheck = now;
  return checkLatency().then((latency) => latency > LATENCY_THRESHOLD_MS);
}

export async function enqueuePosition(pos: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  const size = await queueSize();
  if (size >= QUEUE_MAX_SIZE) {
    const oldest = await dequeueOldest();
    if (!oldest) return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...pos, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dequeueAllPositions(): Promise<Record<string, unknown>[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dequeueOldest(): Promise<Record<string, unknown> | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const item = cursor.value;
        cursor.delete();
        resolve(item);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueSize(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function flushQueue(sendFn: (positions: Record<string, unknown>[]) => Promise<void>): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const positions = await dequeueAllPositions();
    if (positions.length === 0) return;
    await sendFn(positions);
    await clearQueue();
  } finally {
    isFlushing = false;
  }
}
