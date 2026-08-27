package com.logitrack.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;

import java.util.Locale;

/**
 * Détection des surcouches constructeur à gestion batterie agressive (très
 * répandues à Madagascar : Xiaomi/MIUI, Huawei/EMUI, Oppo/ColorOS, Vivo,
 * OnePlus…).
 *
 * Ces OS ajoutent UNE couche de gestion batterie EN PLUS de celle d'Android
 * standard : même avec l'exemption Android (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 * accordée, ils tuent l'app en arrière-plan — il faut en plus activer le
 * "démarrage automatique" (autostart) et/ou verrouiller l'app dans le
 * gestionnaire de tâches récentes, écran par écran, non automatisable de façon
 * fiable par du code.
 *
 * Ce helper détecte la marque (Build.MANUFACTURER / Build.BRAND, insensibles à
 * la casse) et expose DEUX familles de deep-link système, car certaines
 * marques (Xiaomi/MIUI en tête, cause racine confirmée audit 2026-08-27)
 * séparent en DEUX écrans distincts ce qui est nécessaire pour survivre en
 * arrière-plan :
 *  - autostartIntent() : "démarrage automatique" — l'app peut se relancer
 *    elle-même après avoir été balayée des tâches récentes ;
 *  - batterySaverIntent() : "économie d'énergie par application" — l'OS ne
 *    gèle pas le process (WorkManager inclus) en arrière-plan prolongé.
 * Avec repli systématique sur la page de détails de l'app (présente sur
 * TOUTES les surcouches, contient le réglage Batterie → Sans restriction) si
 * la marque n'a pas d'écran dédié connu, ou si l'écran a été renommé/supprimé
 * sur la version d'OS installée.
 *
 * Les noms de package/activité ci-dessous sont stables historiquement mais
 * varient selon les versions d'OS : chaque ouverture est protégée par
 * resolveActivity() et retombe proprement sur le repli. Niveau de confiance
 * détaillé sur chaque méthode : certains composants sont vérifiés sur un
 * appareil physique (Xiaomi), d'autres reposent sur une documentation
 * communautaire large mais non vérifiée localement (Huawei/Honor/Vivo) — dans
 * les deux cas, un échec ne bloque jamais le chauffeur : repli automatique.
 */
public final class DeviceOemInfo {

    private DeviceOemInfo() {
    }

    /** Clé OEM normalisée (utilisée côté JS pour afficher les bonnes instructions). */
    public static final String OEM_UNKNOWN = "other";
    public static final String OEM_XIAOMI = "xiaomi";
    public static final String OEM_HUAWEI = "huawei";
    public static final String OEM_HONOR = "honor";
    public static final String OEM_OPPO = "oppo";
    public static final String OEM_VIVO = "vivo";
    public static final String OEM_ONEPLUS = "oneplus";
    public static final String OEM_REALME = "realme";
    public static final String OEM_SAMSUNG = "samsung";

    /**
     * Détecte la marque et renvoie un JSObject prêt à être renvoyé au JS :
     * { oem, manufacturer, brand, model, os, sdkInt, aggressive,
     *   autostartIntent, autostartAction }
     */
    public static JSObject detect() {
        String manufacturer = safe(Build.MANUFACTURER);
        String brand = safe(Build.BRAND);
        String model = safe(Build.MODEL);

        String oem = detectOem(manufacturer, brand);

        JSObject ret = new JSObject();
        ret.put("oem", oem);
        ret.put("manufacturer", manufacturer);
        ret.put("brand", brand);
        ret.put("model", model);
        ret.put("os", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        // true = surcouche agressive qui exige des réglages manuels EN PLUS de
        // l'exemption Android standard.
        ret.put("aggressive", isAggressive(oem));

        String[] autostart = autostartIntent(oem);
        if (autostart != null) {
            ret.put("autostartIntent", autostart[0]);
            ret.put("autostartAction", autostart[1]);
        }
        // hasBatterySaverScreen : indique au JS s'il faut afficher un DEUXIÈME
        // bouton de réglage (voir openBatterySaverSettings ci-dessous) — certaines
        // marques séparent "démarrage automatique" et "économie d'énergie par
        // application" en DEUX écrans système distincts (voir batterySaverIntent).
        ret.put("hasBatterySaverScreen", batterySaverIntent(oem) != null);
        return ret;
    }

    /** true si la marque a une couche de gestion batterie propriétaire agressive. */
    public static boolean isAggressive(String oem) {
        switch (oem) {
            case OEM_XIAOMI:
            case OEM_HUAWEI:
            case OEM_HONOR:
            case OEM_OPPO:
            case OEM_VIVO:
            case OEM_ONEPLUS:
            case OEM_REALME:
                return true;
            default:
                return false;
        }
    }

    private static String detectOem(String manufacturer, String brand) {
        String m = manufacturer.toLowerCase(Locale.ROOT);
        String b = brand.toLowerCase(Locale.ROOT);
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") || b.contains("xiaomi")) {
            return OEM_XIAOMI;
        }
        if (m.contains("huawei") || m.contains("honor") || b.contains("huawei") || b.contains("honor")) {
            return m.contains("honor") || b.contains("honor") ? OEM_HONOR : OEM_HUAWEI;
        }
        if (m.contains("oppo") || b.contains("oppo")) {
            return OEM_OPPO;
        }
        if (m.contains("realme") || b.contains("realme")) {
            return OEM_REALME;
        }
        if (m.contains("oneplus") || b.contains("oneplus")) {
            return OEM_ONEPLUS;
        }
        if (m.contains("vivo") || b.contains("vivo") || m.contains("iqoo")) {
            return OEM_VIVO;
        }
        if (m.contains("samsung") || b.contains("samsung")) {
            return OEM_SAMSUNG;
        }
        return OEM_UNKNOWN;
    }

    /**
     * Intent deep-link vers l'écran "démarrage automatique / gestion en
     * arrière-plan" propre à la marque. Retourne [package, activity] ou null.
     * Ces écrans permettent d'autoriser l'app à démarrer et rester en
     * arrière-plan — LE réglage qui manque quand l'exemption Android est déjà
     * accordée mais que l'app meurt quand même.
     */
    private static String[] autostartIntent(String oem) {
        switch (oem) {
            case OEM_XIAOMI:
                // MIUI / HyperOS : "Démarrage automatique" (Autostart).
                return new String[]{
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                };
            case OEM_HUAWEI:
            case OEM_HONOR:
                // EMUI : gestionnaire système → "Démarrage" des applications.
                return new String[]{
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
                };
            case OEM_OPPO:
            case OEM_REALME:
            case OEM_ONEPLUS:
                // ColorOS / realme UI : "Gestion du démarrage automatique".
                return new String[]{
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"
                };
            case OEM_VIVO:
                // Funtouch / OriginOS : "Gestion de démarrage en arrière-plan".
                return new String[]{
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                };
            default:
                // Samsung (One UI) et Android quasi stock : pas d'écran d'autostart
                // dédié fiable — le réglage passe par la page de détails de l'app
                // (Batterie → Sans restriction / Autoriser en arrière-plan).
                return null;
        }
    }

    /**
     * Ouvre l'écran système le plus pertinent pour la marque : l'écran
     * d'autostart si la marque en a un et qu'il est résolvable, sinon la page
     * de détails de l'app (Batterie → Sans restriction, présente partout).
     * Retourne une description de l'écran ouvert (pour le log / l'UI).
     */
    public static String openBestSettings(Context context) {
        String oem = detectOem(safe(Build.MANUFACTURER), safe(Build.BRAND));
        if (isAggressive(oem)) {
            String[] target = autostartIntent(oem);
            if (target != null) {
                try {
                    Intent intent = new Intent();
                    intent.setClassName(target[0], target[1]);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (intent.resolveActivity(context.getPackageManager()) != null) {
                        context.startActivity(intent);
                        return "autostart:" + oem;
                    }
                } catch (Exception ignored) {
                    // L'écran a pu être renommé/supprimé selon la version d'OS →
                    // repli sur la page de détails de l'app.
                }
            }
        }
        // Repli universel : page de détails de l'app (Batterie → Sans restriction).
        try {
            Intent appDetails = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + context.getPackageName())
            );
            appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(appDetails);
            return "app_details";
        } catch (Exception e) {
            return "failed";
        }
    }

    /**
     * BUG CORRIGÉ (audit terrain 2026-08-27, cause racine confirmée sur appareil
     * réel — 3 coupures de tracking de 1h30-2h en une journée, malgré l'exemption
     * Android standard ET l'autostart tous deux déjà accordés). Plusieurs
     * surcouches ont une TROISIÈME couche de restriction, INDÉPENDANTE des deux
     * premières : une « économie d'énergie » PAR APPLICATION, distincte de
     * l'autostart. Même avec REQUEST_IGNORE_BATTERY_OPTIMIZATIONS accordé
     * (confirmé sur l'appareil de test via `dumpsys deviceidle whitelist`) et le
     * démarrage automatique activé, ce troisième réglage — laissé sur sa valeur
     * par défaut — suffit à geler périodiquement l'app en arrière-plan (y
     * compris WorkManager, ce qui explique pourquoi le watchdog de 15 min
     * mettait 1h30-2h à redémarrer le service : ses propres exécutions étaient
     * elles-mêmes gelées).
     *
     * NIVEAU DE CONFIANCE PAR MARQUE (voir batterySaverIntent ci-dessous) :
     *  - Xiaomi/MIUI : VÉRIFIÉ DIRECTEMENT sur l'appareil réel de test (adb,
     *    resolveActivity + confirmation ResumedActivity après lancement).
     *  - Huawei/Honor/Vivo : composants documentés de façon stable et répétée
     *    dans plusieurs bibliothèques open-source de guidage batterie
     *    constructeur (à large diffusion), mais PAS vérifiés sur un appareil
     *    physique de cette marque — protégés comme l'autostart par
     *    resolveActivity() + repli sur la page de détails de l'app si l'écran a
     *    été renommé/supprimé sur une version d'OS donnée.
     *  - Oppo/Realme/OnePlus : PAS de deep-link ajouté ici — la variabilité des
     *    noms d'écran entre versions ColorOS est trop grande pour un choix
     *    fiable sans appareil de test ; ces marques regroupent de toute façon
     *    souvent ce réglage dans l'écran de démarrage automatique déjà couvert.
     *  - Samsung (One UI) : pas de couche propriétaire séparée connue au-delà de
     *    l'API Android standard (Batterie → Sans restriction, déjà couverte par
     *    l'exemption standard) — aucun deep-link nécessaire.
     */
    private static String[] batterySaverIntent(String oem) {
        switch (oem) {
            case OEM_XIAOMI:
                // MIUI / HyperOS : "Économie d'énergie" par application (省电策略).
                return new String[]{
                    "com.miui.powerkeeper",
                    "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"
                };
            case OEM_HUAWEI:
            case OEM_HONOR:
                // EMUI / Magic UI : "Applications protégées" (受保护应用) — distinct
                // de l'écran de démarrage automatique (StartupNormalAppListActivity).
                return new String[]{
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"
                };
            case OEM_VIVO:
                // Funtouch / OriginOS : gestion des applications à forte
                // consommation en arrière-plan.
                return new String[]{
                    "com.vivo.abe",
                    "com.vivo.abe.PurviewTabActivity"
                };
            default:
                return null;
        }
    }

    public static String openBatterySaverSettings(Context context) {
        String oem = detectOem(safe(Build.MANUFACTURER), safe(Build.BRAND));
        String[] target = batterySaverIntent(oem);
        if (target != null) {
            try {
                Intent intent = new Intent();
                if (OEM_XIAOMI.equals(oem)) {
                    // MIUI exige l'action explicite ET les extras package_name/
                    // package_label (sans l'action, certaines versions ignorent
                    // silencieusement l'intent malgré une resolveActivity() positive).
                    intent.setAction("miui.intent.action.HIDDEN_APPS_CONFIG_ACTIVITY");
                    intent.putExtra("package_name", context.getPackageName());
                    intent.putExtra(
                        "package_label",
                        context.getApplicationInfo().loadLabel(context.getPackageManager())
                    );
                }
                intent.setClassName(target[0], target[1]);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (intent.resolveActivity(context.getPackageManager()) != null) {
                    context.startActivity(intent);
                    return "battery_saver:" + oem;
                }
            } catch (Exception ignored) {
                // Écran renommé/supprimé sur cette version d'OS → repli ci-dessous.
            }
        }
        // Repli universel : page de détails de l'app (même repli que openBestSettings).
        try {
            Intent appDetails = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + context.getPackageName())
            );
            appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(appDetails);
            return "app_details";
        } catch (Exception e) {
            return "failed";
        }
    }

    private static String safe(String value) {
        return value != null ? value : "";
    }
}
