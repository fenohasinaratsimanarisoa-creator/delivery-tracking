import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNativeApp } from '../../services/native/nativeAuth';
import {
  fetchLatestMobileApp,
  isVersionOutdated,
  compareBuild,
  CRITICAL_BUILD_GAP,
  type MobileAppRelease,
} from '../../services/mobileApp';
import styles from './MobileUpdateBanner.module.css';

/**
 * Détection d'app obsolète installée (ferme la boucle « toujours à jour ») :
 * au démarrage de l'app native (Capacitor), compare la version installée
 * (App.getInfo) à la dernière release publiée par la CI.
 *
 * BUG CORRIGÉ (audit 2026-08-28) : la comparaison portait sur le versionName
 * (`info.version`), calculé par la CI à partir des tags git. Or ce nom PEUT SE
 * FIGER — c'est arrivé réellement : deux APK différents ont porté « 0.0.59 »
 * (voir le correctif du job `android-release`). La bannière concluait alors
 * « à jour » alors que l'appareil tournait un binaire de plusieurs jours plus
 * ancien — donc SANS les correctifs natifs de perte de données GPS (A1/A2/A3),
 * qui ne vivent que dans l'APK et qu'un serveur à jour ne compense pas.
 *
 * On compare désormais le versionCode (`info.build` = `git rev-list --count`,
 * strictement croissant et jamais réutilisé), et on ne retombe sur le
 * versionName que si le build est illisible. Au-delà de CRITICAL_BUILD_GAP
 * commits de retard, la bannière passe en mode CRITIQUE : elle explique le
 * risque réel (positions GPS perdues) au lieu d'un simple « une mise à jour est
 * disponible » facile à ignorer.
 *
 * Ne s'exécute QUE dans l'app native — jamais sur le web (là, c'est
 * MobileAppBanner qui propose l'installation).
 */
export default function MobileUpdateBanner() {
  const { t } = useTranslation();
  const [outdated, setOutdated] = useState(false);
  const [critical, setCritical] = useState(false);
  const [release, setRelease] = useState<MobileAppRelease | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const latest = await fetchLatestMobileApp();
        if (cancelled || !latest) return;

        // Signal PRIMAIRE : le versionCode, seul identifiant strictement croissant.
        const build = compareBuild(info.build, latest.versionCode);
        if (build) {
          if (build.outdated) {
            setRelease(latest);
            setOutdated(true);
            setCritical(build.gap >= CRITICAL_BUILD_GAP);
          }
          return;
        }

        // Repli : versionCode illisible (plateforme non Android, info absente).
        if (isVersionOutdated(info.version || '', latest.version)) {
          setRelease(latest);
          setOutdated(true);
        }
      } catch {
        // Échec de la vérification : silencieux, ne bloque jamais le tracking.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isNativeApp() || checking || !outdated || !release) return null;

  // Aucune action « masquer » n'est proposée, à dessein : un APK obsolète perd
  // silencieusement des positions GPS. Le seul moyen de faire disparaître cette
  // bannière est d'installer la mise à jour.
  return (
    <div
      className={`${styles.banner} ${critical ? styles.critical : ''}`}
      role={critical ? 'alert' : 'region'}
      aria-label={t('mobileApp.update.ariaLabel')}
    >
      <div className={styles.content}>
        <p className={styles.title}>
          {critical
            ? t('mobileApp.update.criticalTitle', { version: release.version })
            : t('mobileApp.update.title', { version: release.version })}
        </p>
        <p className={styles.subtitle}>
          {critical ? t('mobileApp.update.criticalSubtitle') : t('mobileApp.update.subtitle')}
        </p>
      </div>
      <div className={styles.actions}>
        <a
          className={styles.downloadLink}
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('mobileApp.update.download', { version: release.version })}
        </a>
      </div>
    </div>
  );
}
