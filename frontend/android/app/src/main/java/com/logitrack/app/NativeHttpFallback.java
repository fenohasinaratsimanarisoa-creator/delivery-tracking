package com.logitrack.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Stockage de l'URL de base de l'API, réutilisé par PositionUploadWorker (Phase 4)
 * — l'URL n'est pas un secret, aucune raison de la chiffrer comme le token natif
 * (voir NativeAuthTokenStore).
 *
 * SUPPRIMÉ (audit 2026-08-27) : le mécanisme d'envoi HTTP direct de secours
 * (Option B, audit 21/08/2026 — "sendPosition"/"shouldActivate"/stockage du
 * token en clair sous PREF_TOKEN) postait vers "{apiUrl}/tracking/batch-position",
 * une route qui n'a JAMAIS existé côté backend (seul /tracking/positions/
 * native-batch existe) — 404 systématique depuis sa création, invisible en
 * pratique (Log.w seul, logcat bloqué par MIUI sur l'appareil de test). Il
 * était de toute façon devenu redondant : le pipeline LocationQueueDb →
 * PositionUploadWorker (corrigé le même jour : CSRF, URL, expedited work)
 * déclenche désormais un envoi au plus tard 15 s après chaque insertion,
 * largement plus réactif que le seuil de 2 min de silence JS que ce
 * mécanisme attendait — et le garder aurait réintroduit la même classe de
 * bug que le doublon socket/natif corrigé le même jour (deux chemins
 * d'envoi indépendants avec des timestamps différents pour le même fix,
 * échappant tous deux à la contrainte unique (vehicleId, timestamp) en
 * base). Le token en clair qu'il lisait n'a donc plus aucun lecteur — plutôt
 * que de le laisser orphelin sur le disque de l'appareil sans plus aucun
 * bénéfice fonctionnel, tout le mécanisme de stockage du token est retiré
 * avec lui (voir BackgroundLocationPlugin, storeNativeFallbackToken retiré).
 */
public class NativeHttpFallback {

    /** SharedPreferences contenant l'URL API (nom conservé pour compatibilité —
     * un renommage forcerait une réécriture au prochain démarrage sans bénéfice). */
    private static final String PREFS_NAME = "logitrack_native_fallback";
    private static final String PREF_API_URL = "api_base_url";

    /**
     * Écrit l'URL de base de l'API dans SharedPreferences (appelé par le JS au démarrage).
     */
    public static void storeApiUrl(Context context, String apiUrl) {
        if (apiUrl == null || apiUrl.isEmpty()) return;
        getPrefs(context).edit().putString(PREF_API_URL, apiUrl).apply();
    }

    /**
     * Lit l'URL de base de l'API déjà stockée. Réutilisé par PositionUploadWorker
     * (Phase 4) — évite de dupliquer un second mécanisme de stockage d'URL pour
     * le même besoin (l'URL n'est pas un secret, aucune raison de la chiffrer
     * comme le token — voir NativeAuthTokenStore).
     */
    public static String getApiUrl(Context context) {
        return getPrefs(context).getString(PREF_API_URL, null);
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
