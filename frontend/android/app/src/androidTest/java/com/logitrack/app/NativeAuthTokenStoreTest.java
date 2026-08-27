package com.logitrack.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Tests instrumentés de NativeAuthTokenStore (Phase 3 — pont du token
 * d'authentification vers le natif, EncryptedSharedPreferences).
 *
 * Nécessite un appareil/émulateur (KeyStore matériel réel, pas de simulation
 * JVM) :
 *   cd frontend/android && ./gradlew connectedAndroidTest --tests "*.NativeAuthTokenStoreTest"
 */
@RunWith(AndroidJUnit4.class)
public class NativeAuthTokenStoreTest {

    // Miroir du nom de fichier PRIVÉ de NativeAuthTokenStore (PREFS_FILE) —
    // nécessaire pour localiser le fichier XML brut sur disque et vérifier
    // qu'il ne contient PAS le token en clair. Si ce nom change là-bas, ce
    // test doit être mis à jour (c'est le but : verrou de non-régression).
    private static final String PREFS_FILE_NAME = "logitrack_native_auth_encrypted";

    private Context context;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeAuthTokenStore.clear(context);
    }

    @Test
    public void setAuthToken_thenGetAuthToken_roundTripsCorrectly() {
        String token = "eyFAKE.JWT.TOKEN-abc123XYZ";
        long expiresAt = System.currentTimeMillis() + 900_000L; // +15 min

        boolean written = NativeAuthTokenStore.setAuthToken(context, token, expiresAt);
        assertTrue("Une écriture réussie doit renvoyer true (audit GPS 2026-08-27)", written);

        NativeAuthTokenStore.StoredToken stored = NativeAuthTokenStore.getAuthToken(context);
        assertNotNull("Le token doit être lisible immédiatement après écriture", stored);
        assertEquals(token, stored.token);
        assertEquals(expiresAt, stored.expiresAtEpochMs);
        assertFalse("Un token qui expire dans 15 min ne doit pas être considéré expiré", stored.isExpired());
    }

    /**
     * RÉGRESSION (audit GPS 2026-08-27, MOYENNE) : setAuthToken() avec un token
     * vide/null doit renvoyer false (échec) plutôt que réussir silencieusement —
     * BackgroundLocationPlugin en dépend pour rejeter l'appel JS au lieu de le
     * résoudre à tort (ce qui écrirait un faux positif dans le cache
     * anti-répétition de deviceToken.ts côté JS).
     */
    @Test
    public void setAuthToken_withEmptyToken_returnsFalse() {
        assertFalse(NativeAuthTokenStore.setAuthToken(context, "", System.currentTimeMillis() + 900_000L));
        assertFalse(NativeAuthTokenStore.setAuthToken(context, null, System.currentTimeMillis() + 900_000L));
        assertNull("Rien ne doit être stocké après un appel refusé", NativeAuthTokenStore.getAuthToken(context));
    }

    @Test
    public void getAuthToken_returnsNull_whenNothingStored() {
        NativeAuthTokenStore.StoredToken stored = NativeAuthTokenStore.getAuthToken(context);
        assertNull(stored);
    }

    @Test
    public void isExpired_trueForPastTimestamp() {
        String token = "eyFAKE.EXPIRED.TOKEN";
        long expiresAt = System.currentTimeMillis() - 1000L; // déjà expiré

        NativeAuthTokenStore.setAuthToken(context, token, expiresAt);

        NativeAuthTokenStore.StoredToken stored = NativeAuthTokenStore.getAuthToken(context);
        assertNotNull(stored);
        assertTrue(stored.isExpired());
    }

    @Test
    public void clear_removesStoredToken() {
        NativeAuthTokenStore.setAuthToken(context, "eyFAKE.TOKEN", System.currentTimeMillis() + 900_000L);
        assertNotNull(NativeAuthTokenStore.getAuthToken(context));

        NativeAuthTokenStore.clear(context);

        assertNull(NativeAuthTokenStore.getAuthToken(context));
    }

    /**
     * PREUVE DE CHIFFREMENT : le fichier XML brut de SharedPreferences (sur le
     * disque de l'appareil, hors de toute API Android) ne doit JAMAIS contenir
     * la chaîne du token en clair — c'est précisément ce qu'EncryptedSharedPreferences
     * garantit et que ce test vérifie directement, au niveau fichier, plutôt que
     * de faire confiance à l'API seule.
     */
    @Test
    public void rawPrefsFileOnDisk_neverContainsTokenInPlainText() throws Exception {
        String secretToken = "eyFAKE.SUPER-SECRET-TOKEN-DO-NOT-LEAK.xyz789";
        NativeAuthTokenStore.setAuthToken(context, secretToken, System.currentTimeMillis() + 900_000L);

        File prefsFile = new File(
            context.getApplicationInfo().dataDir + "/shared_prefs/" + PREFS_FILE_NAME + ".xml"
        );
        assertTrue("Le fichier shared_prefs doit exister après une écriture", prefsFile.exists());

        byte[] rawBytes = Files.readAllBytes(prefsFile.toPath());
        String rawContent = new String(rawBytes, StandardCharsets.UTF_8);

        assertFalse(
            "Le token NE DOIT JAMAIS apparaître en clair dans le fichier de préférences sur disque",
            rawContent.contains(secretToken)
        );
    }
}
