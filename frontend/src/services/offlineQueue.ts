const DB_NAME = 'delivery-tracking';
const STORE_NAME = 'position-queue';
const DB_VERSION = 1;

// Capacité de la file locale (IndexedDB, persistante sur disque — survit à un kill
// de l'app par l'OS). 5000 positions à la cadence de 3 s ≈ 4 h de coupure réseau
// couvertes SANS perte. L'ancienne limite de 500 (~25 min) écrasait silencieusement
// les positions les plus anciennes au-delà — inacceptable pour la fidélité du trajet
// enregistré pendant une coupure prolongée. Au-delà de 5000, l'éviction du plus ancien
// est désormais SIGNALÉE (droppedOldest → alerte explicite dans l'app), jamais silencieuse.
const QUEUE_MAX_SIZE = 5000;
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

// Connexion IndexedDB PARTAGÉE et réutilisée (une seule ouverture, pas une par
// position) : chaque enqueuePosition/queueSize ouvrait une nouvelle connexion —
// inutile sur mobile (coût mémoire/CPU à chaque fix GPS) et bloquant sur de
// longs rattrapages (5000 positions = 5000 ouvertures).
let dbPromise: Promise<IDBDatabase> | null = null;
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB();
    // Si la connexion échoue (storage indisponible), on permet une nouvelle
    // tentative au prochain appel plutôt que de rester sur la promesse rejetée.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function checkLatency(): Promise<number> {
  const start = Date.now();
  try {
    const db = await getDB();
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
  if (now - lastLatencyCheck < 10000) return checkLatency().then((latency) => latency > LATENCY_THRESHOLD_MS);
  lastLatencyCheck = now;
  return checkLatency().then((latency) => {
    lastLatencyCheck = Date.now();
    return latency > LATENCY_THRESHOLD_MS;
  });
}

export interface EnqueueResult {
  /** true si la position a été stockée dans la file locale. */
  queued: boolean;
  /** true si la file était pleine et qu'une position plus ancienne a dû être évincée. */
  droppedOldest: boolean;
}

/**
 * Stocke une position dans la file locale (IndexedDB, persistante sur disque).
 * Ne perd JAMAIS une position silencieusement : si la capacité maximale est
 * atteinte, la position la plus ANCIENNE est évincée et l'appelant est informé
 * via droppedOldest (l'app affiche alors une alerte explicite) — en dessous de
 * 5000 entrées (~4 h de coupure), AUCUNE perte n'a lieu.
 */
export async function enqueuePosition(
  pos: Record<string, unknown>,
): Promise<EnqueueResult> {
  const db = await getDB();
  const size = await queueSize();
  let droppedOldest = false;
  if (size >= QUEUE_MAX_SIZE) {
    const oldest = await dequeueOldest();
    if (!oldest) return { queued: false, droppedOldest };
    droppedOldest = true;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...pos, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve({ queued: true, droppedOldest });
    tx.onerror = () => reject(tx.error);
  });
}

export async function dequeueAllPositions(): Promise<Record<string, unknown>[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dequeueOldest(): Promise<Record<string, unknown> | null> {
  const db = await getDB();
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
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueSize(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePositions(ids: number[]): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushQueue(sendFn: (positions: Record<string, unknown>[]) => Promise<void>): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const positions = await dequeueAllPositions();
    if (positions.length === 0) return;
    const ids = positions.map((p) => p.id as number);
    await sendFn(positions);
    await deletePositions(ids);
  } finally {
    isFlushing = false;
  }
}
