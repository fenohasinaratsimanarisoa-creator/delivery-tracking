const DB_NAME = 'delivery-tracking';
const STORE_NAME = 'position-queue';
const DB_VERSION = 1;

// Capacité de la file locale (IndexedDB, persistante sur disque — survit à un kill
// de l'app par l'OS). 10000 positions à la cadence de 3 s ≈ 8 h 20 de coupure
// réseau en PLEINE résolution (quota doublé par rapport aux 5000 ≈ 4 h d'avant).
// Au-delà, la stratégie est SANS perte : on COMPACTE d'abord les positions
// anciennes (1 point représentatif par tranche de 45 s, voir
// compactOldestPositions) — le quota ne borne donc plus la DURÉE de coupure
// couverte, il ne fait que dégrader la résolution des positions les plus
// anciennes. L'éviction d'un point ancien n'arrive plus qu'en dernier recours
// (file entièrement récente), et elle est TOUJOURS signalée (droppedOldest →
// alerte explicite dans l'app), jamais silencieuse. Choix documenté (prompt 4
// de l'audit) : option A (compression des anciennes) + mécanisme d'alerte
// précoce de l'option B (nearCapacity à 80 %) — l'augmentation du quota est
// bornée volontairement (×2) car la compaction rend la capacité non-limitante
// pour la fidélité du trajet.
export const QUEUE_MAX_SIZE = 10000;
// Alerte précoce à 80 % du quota (option B) : la saturation n'arrive jamais
// sans signe avant-coureur — enqueuePosition remonte `nearCapacity` dès que la
// file dépasse ce seuil, bien avant la moindre perte ou compaction.
export const QUEUE_WARN_FRACTION = 0.8;
export const QUEUE_WARN_SIZE = Math.floor(QUEUE_MAX_SIZE * QUEUE_WARN_FRACTION);
// Stratégie sans perte pour les coupures très longues (option A) : au lieu de
// supprimer une à une les positions les plus anciennes une fois le quota
// dépassé, on COMPACTE les positions plus vieilles que COMPACT_HORIZON_MS —
// une seule position représentative par tranche de COMPACT_BUCKET_MS (la
// première, marquée `compressed: true`) remplace toutes celles de sa tranche.
// La trace complète du trajet reste couverte (résolution dégradée sur le
// segment ancien, pleine résolution sur les dernières minutes) : AUCUNE
// position n'est supprimée sans qu'une représentante de sa tranche ne subsiste.
const COMPACT_HORIZON_MS = 5 * 60 * 1000;
const COMPACT_BUCKET_MS = 45 * 1000;
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

// Dernier verdict de latence connu, réutilisé pendant la fenêtre de throttle.
let lastLatencyVerdict = false;

/**
 * BUG CORRIGÉ (audit GPS 2026-08-28, B5) : le throttle de 10 s était MORT — les
 * deux branches du `if` appelaient `checkLatency()`, donc une mesure IndexedDB
 * était faite à CHAQUE appel (soit à chaque fix GPS, ~toutes les 3 s) alors que
 * l'intention documentée était d'en faire une au plus toutes les 10 s. On
 * renvoie désormais le dernier verdict connu pendant la fenêtre, sans toucher au
 * disque.
 */
export function shouldQueueDueToLatency(): Promise<boolean> {
  const now = Date.now();
  if (now - lastLatencyCheck < 10000) {
    return Promise.resolve(lastLatencyVerdict);
  }
  lastLatencyCheck = now;
  return checkLatency().then((latency) => {
    lastLatencyCheck = Date.now();
    lastLatencyVerdict = latency > LATENCY_THRESHOLD_MS;
    return lastLatencyVerdict;
  });
}

export interface EnqueueResult {
  /** true si la position a été stockée dans la file locale. */
  queued: boolean;
  /** true si la file était pleine et qu'une position plus ancienne a dû être évincée. */
  droppedOldest: boolean;
  /** true si la file dépasse 80 % du quota (alerte précoce, bien avant toute perte). */
  nearCapacity: boolean;
}

/**
 * Stocke une position dans la file locale (IndexedDB, persistante sur disque).
 * Stratégie SANS perte sur les coupures très longues :
 * - quota doublé (10000 ≈ 8 h 20 de pleine résolution) ;
 * - au-delà du quota, COMPACTION d'abord (les positions plus vieilles que
 *   COMPACT_HORIZON_MS sont remplacées par 1 représentante par tranche de 45 s,
 *   marquée `compressed: true` — la trace reste complète, résolution dégradée
 *   sur le segment ancien, quelle que soit la durée de la coupure) ;
 * - éviction du plus ancien UNIQUEMENT si rien n'est compactable (file
 *   entièrement récente), TOUJOURS signalée via droppedOldest (l'app affiche
 *   alors une alerte explicite) — jamais de perte silencieuse ;
 * - dès 80 % du quota, nearCapacity remonte (alerte précoce, option B).
 */
export async function enqueuePosition(
  pos: Record<string, unknown>,
): Promise<EnqueueResult> {
  const db = await getDB();
  let size = await queueSize();
  let droppedOldest = false;
  if (size >= QUEUE_MAX_SIZE) {
    // Quota atteint : compaction des positions anciennes AVANT toute éviction.
    // Ne s'exécute qu'à saturation (le scan curseur a un coût, payé seulement
    // quand il est nécessaire).
    await compactOldestPositions();
    size = await queueSize();
  }
  if (size >= QUEUE_MAX_SIZE) {
    // Rien de compactable (file entièrement récente) : éviction du plus ancien,
    // TOUJOURS signalée — jamais silencieuse.
    const oldest = await dequeueOldest();
    if (!oldest) return { queued: false, droppedOldest, nearCapacity: false };
    droppedOldest = true;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...pos, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve({
      queued: true,
      droppedOldest,
      // Alerte précoce à 80 % du quota (option B) : l'app prévient bien avant
      // toute saturation/compaction/perte.
      nearCapacity: size + 1 >= QUEUE_WARN_SIZE,
    });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Compaction de la file SANS perte (option A) : remplace les positions plus
 * anciennes que COMPACT_HORIZON_MS par UNE position représentative par tranche
 * de COMPACT_BUCKET_MS (la première du bucket, marquée `compressed: true`).
 * Retourne true si au moins une position a été remplacée/supprimée. Le
 * bucketing se fait sur le timestamp GPS de la position (`timestamp`, repli
 * sur `queuedAt`) : pendant une longue coupure, la trace horodatée est
 * préservée dans son intégralité, juste à résolution réduite sur le segment
 * ancien.
 */
async function compactOldestPositions(): Promise<boolean> {
  const db = await getDB();
  const cutoff = Date.now() - COMPACT_HORIZON_MS;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // bucketTs (début de tranche) → id de la position représentative conservée.
    const keptPerBucket = new Map<number, number>();
    const toDelete: number[] = [];
    const scan = store.openCursor();
    scan.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const value = cursor.value as Record<string, unknown>;
        const ts = new Date(String(value.timestamp ?? value.queuedAt ?? '')).getTime();
        if (Number.isFinite(ts) && ts > 0 && ts < cutoff) {
          const bucketTs = Math.floor(ts / COMPACT_BUCKET_MS) * COMPACT_BUCKET_MS;
          const keptId = keptPerBucket.get(bucketTs);
          if (keptId === undefined) {
            // Première position de la tranche : conservée, marquée compressée.
            keptPerBucket.set(bucketTs, value.id as number);
            cursor.update({ ...value, compressed: true });
          } else if (keptId !== value.id) {
            // Positions suivantes de la même tranche : remplacées par leur
            // représentante — AUCUNE perte de trace (la représentante couvre
            // la tranche), juste une résolution dégradée sur le segment ancien.
            toDelete.push(value.id as number);
          }
        }
        cursor.continue();
      } else {
        // Scan terminé : purge des points absorbés par leur représentante.
        if (toDelete.length === 0) {
          resolve(false);
          return;
        }
        for (const id of toDelete) store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      }
    };
    scan.onerror = () => reject(scan.error);
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
