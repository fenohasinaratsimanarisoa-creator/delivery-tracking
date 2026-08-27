import api from '../api/client';
import { setNativeAuthToken } from '../tracking/backgroundLocation';

/** Horodatage du dernier push réussi vers le natif (localStorage : survit au kill de process). */
const LAST_PUSH_KEY = 'dt_device_token_pushed_at';
/** Re-pousse le credential au plus une fois par 24 h (il vit 30 jours côté serveur). */
const REPUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Récupère le credential LONGUE DURÉE du worker natif de tracking et l'écrit
 * dans le stockage chiffré natif (NativeAuthTokenStore).
 *
 * POURQUOI (audit 2026-08-27, diagnostiqué sur appareil réel) : le natif
 * utilisait jusqu'ici l'ACCESS TOKEN (15 min), renouvelable UNIQUEMENT par le
 * JS. En veille, la WebView est gelée : passé 15 min, le worker n'avait plus
 * aucun credential valide et cessait SILENCIEUSEMENT d'envoyer — les positions
 * s'accumulaient en SQLite sans jamais partir. Preuve terrain : 168 positions
 * bloquées 11 min (le worker tournait pourtant toutes les ~20 s), toutes
 * parties à la seconde où le JS a rafraîchi le token.
 *
 * Le device token (scope 'device_tracking', 30 jours) rend le worker natif
 * AUTONOME : plus aucune dépendance au JS pour rester authentifié. Il ne peut
 * servir QUE sur POST /tracking/positions/native-batch (voir
 * DeviceTrackingAuthGuard côté serveur) et suit la révocation de session.
 *
 * No-op silencieux sur web/iOS (setNativeAuthToken → resolvePlugin() null) et
 * en cas d'échec réseau : le prochain démarrage/login réessaiera.
 */
export async function ensureNativeDeviceToken(force = false): Promise<void> {
  try {
    if (!force) {
      const last = Number(localStorage.getItem(LAST_PUSH_KEY) || 0);
      if (Number.isFinite(last) && last > 0 && Date.now() - last < REPUSH_INTERVAL_MS) {
        return;
      }
    }
    const res = await api.post('/auth/device-token');
    const deviceToken: unknown = res?.data?.deviceToken;
    const expiresAt: unknown = res?.data?.expiresAt;
    if (typeof deviceToken !== 'string' || !deviceToken) return;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return;

    // BUG CORRIGÉ (audit 2026-08-27, HAUTE) : le cache anti-répétition (24h)
    // était écrit inconditionnellement, MÊME si l'écriture native avait
    // réellement échoué (Keystore matériel indisponible/corrompu). Sur un
    // appareil où ça arrive, plus aucune tentative pendant 24h — recréant la
    // même panne que celle corrigée le même jour, avec un blocage de 24h au
    // lieu de permanent. Le cache n'est désormais écrit QUE si l'écriture a
    // réellement abouti (setNativeAuthToken renvoie maintenant un booléen
    // exploitable — voir backgroundLocation.ts).
    const written = await setNativeAuthToken(deviceToken, expiresAt);
    if (!written) return;
    try {
      localStorage.setItem(LAST_PUSH_KEY, String(Date.now()));
    } catch {
      /* quota/mode privé : le push a eu lieu, seul le cache anti-répétition manque */
    }
  } catch {
    // Jamais bloquant pour l'app : le worker natif garde son credential
    // précédent (encore valide des jours durant) et on réessaiera au prochain
    // démarrage.
  }
}

/** Efface le cache anti-répétition (logout) — force un nouveau push au prochain login. */
export function clearDeviceTokenPushCache(): void {
  try {
    localStorage.removeItem(LAST_PUSH_KEY);
  } catch {
    /* ignore */
  }
}
