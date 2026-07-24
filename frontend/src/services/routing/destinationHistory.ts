const STORAGE_KEY = 'dt-destination-history';
const MAX_ENTRIES = 10;

export interface DestinationEntry {
  lat: number;
  lng: number;
  label: string;
  lastUsed: number;
}

export function getDestinationHistory(): DestinationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DestinationEntry[];
  } catch {
    return [];
  }
}

export function addDestinationHistory(entry: Omit<DestinationEntry, 'lastUsed'>): void {
  const history = getDestinationHistory().filter(
    (h) => !(Math.abs(h.lat - entry.lat) < 0.0001 && Math.abs(h.lng - entry.lng) < 0.0001),
  );
  history.unshift({ ...entry, lastUsed: Date.now() });
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {}
}

export function clearDestinationHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}