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

/**
 * Retourne au maximum `limit` positions, triées par ordre d'insertion (id
 * auto-incrémenté = ordre FIFO), SANS les supprimer. La lecture en curseur
 * évite de charger toute la file en mémoire : nécessaire pour le rattrapage
 * par chunks de plusieurs milliers de positions (longue coupure réseau) — un
 * seul lot surdimensionné dépassait le timeout d'ACK serveur et était rejoué
 * en boucle. `limit = Infinity` lit toute la file (équivalent de
 * dequeueAllPositions).
 */
export async function dequeuePositions(limit: number): Promise<Record<string, unknown>[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const items: Record<string, unknown>[] = [];
    const req = store.openCursor();
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor && items.length < limit) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
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

export async function flushQueue(
  sendFn: (positions: Record<string, unknown>[]) => Promise<void>,
  options?: { chunkSize?: number },
): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const chunkSize = options?.chunkSize ?? Infinity;
    // Rattrapage PAR CHUNKS : un lot de plusieurs milliers de positions (longue
    // coupure réseau) ne doit JAMAIS partir en un seul emit — le traitement
    // serveur dépassait le timeout d'ACK (5s) et rien n'était acquitté, la file
    // n'était pas vidée et le même lot surdimensionné était rejoué en boucle.
    // Chaque chunk n'est envoyé qu'APRÈS l'ACK du précédent (await sendFn), et
    // n'est supprimé de la file QUE si sendFn a résolu : en cas d'échec
    // explicite (timeout), on arrête la boucle et seuls les chunks déjà
    // acquittés ont été purgés — le prochain tick de drainQueue reprend où la
    // file en est, SANS perte silencieuse. Aucune position dont l'envoi n'a pas
    // été explicitement acquitté n'est supprimée.
    while (true) {
      const positions = await dequeuePositions(chunkSize);
      if (positions.length === 0) return;
      const ids = positions.map((p) => p.id as number);
      await sendFn(positions);
      await deletePositions(ids);
    }
  } finally {
    isFlushing = false;
  }
}
