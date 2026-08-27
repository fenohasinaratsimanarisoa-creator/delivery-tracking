package com.logitrack.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Stockage CHIFFRÉ du token d'accès pour le worker natif d'envoi de positions
 * (PositionUploadWorker, Phase 4) — utilisable même quand le JS/WebView ne
 * tourne pas.
 *
 * DIFFÉRENCE avec NativeHttpFallback (stockage existant, SharedPreferences en
 * clair) : ce nouveau store est dédié au chemin REST natif indépendant du
 * socket (POST /tracking/positions/native-batch) et utilise
 * EncryptedSharedPreferences (androidx.security:security-crypto) — le token
 * n'est JAMAIS écrit en clair sur le disque de l'appareil.
 *
 * SÉCURITÉ : ni cette classe ni ses appelants ne doivent JAMAIS logger le
 * token (ni côté Java, ni côté JS) — voir absence totale de Log.*(token) ici.
 */
public final class NativeAuthTokenStore {

    private static final String TAG = "NativeAuthTokenStore";
    private static final String PREFS_FILE = "logitrack_native_auth_encrypted";
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_EXPIRES_AT = "expires_at_epoch_ms";

    private NativeAuthTokenStore() {
    }

    /** Résultat de lecture : token + expiration, ou null si absent/illisible. */
    public static final class StoredToken {
        public final String token;
        public final long expiresAtEpochMs;

        StoredToken(String token, long expiresAtEpochMs) {
            this.token = token;
            this.expiresAtEpochMs = expiresAtEpochMs;
        }

        public boolean isExpired() {
            return System.currentTimeMillis() >= expiresAtEpochMs;
        }
    }

    private static SharedPreferences openEncryptedPrefs(Context context) throws GeneralSecurityException, IOException {
        MasterKey masterKey = new MasterKey.Builder(context.getApplicationContext())
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();
        return EncryptedSharedPreferences.create(
            context.getApplicationContext(),
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    /**
     * Écrit le token d'accès + son expiration. Appelé par le JS (via
     * BackgroundLocationPlugin.setAuthToken) à chaque login() ET à chaque
     * refresh réussi.
     *
     * BUG CORRIGÉ (audit GPS 2026-08-27, MOYENNE) : cette méthode était `void` —
     * un échec Keystore matériel (indisponible/corrompu, cas réel sur certains
     * appareils bas de gamme après une mise à jour OEM) était avalé ici SANS
     * remonter au JS, qui croyait le push réussi. Conséquence en aval :
     * deviceToken.ts écrivait quand même son cache anti-répétition de 24h,
     * bloquant tout nouveau essai pendant 24h alors que le worker natif n'avait
     * JAMAIS reçu de credential exploitable — reproduisant la panne "arrêt
     * d'envoi en veille" corrigée le même jour. Retourne désormais si
     * l'écriture a réellement abouti, pour que l'appelant (BackgroundLocationPlugin)
     * puisse rejeter l'appel plutôt que le résoudre à tort.
     */
    public static boolean setAuthToken(Context context, String accessToken, long expiresAtEpochMs) {
        if (accessToken == null || accessToken.isEmpty()) return false;
        try {
            SharedPreferences prefs = openEncryptedPrefs(context);
            prefs.edit()
                .putString(KEY_TOKEN, accessToken)
                .putLong(KEY_EXPIRES_AT, expiresAtEpochMs)
                .apply();
            return true;
        } catch (GeneralSecurityException | IOException e) {
            // Ne JAMAIS logger l'exception avec le token en paramètre (aucun risque
            // ici : `e` ne contient pas le token). PositionUploadWorker retentera
            // au cycle suivant si aucun token n'est lisible.
            Log.e(TAG, "Echec ecriture token natif chiffre", e);
            return false;
        }
    }

    /**
     * Lit le token courant. Retourne null si absent, illisible, ou si le
     * KeyStore matériel est indisponible (repli sûr : PositionUploadWorker ne
     * tentera rien ce cycle plutôt que d'échouer bruyamment).
     */
    public static StoredToken getAuthToken(Context context) {
        try {
            SharedPreferences prefs = openEncryptedPrefs(context);
            String token = prefs.getString(KEY_TOKEN, null);
            if (token == null || token.isEmpty()) return null;
            long expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L);
            return new StoredToken(token, expiresAt);
        } catch (GeneralSecurityException | IOException e) {
            Log.e(TAG, "Echec lecture token natif chiffre", e);
            return null;
        }
    }

    /** Efface le token (ex. logout côté JS) — jamais appelé pour l'instant, prévu pour extension future. */
    public static void clear(Context context) {
        try {
            openEncryptedPrefs(context).edit().clear().apply();
        } catch (GeneralSecurityException | IOException e) {
            Log.e(TAG, "Echec effacement token natif chiffre", e);
        }
    }
}
