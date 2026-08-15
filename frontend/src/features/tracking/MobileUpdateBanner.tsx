import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNativeApp } from '../../services/native/nativeAuth';
import {
  fetchLatestMobileApp,
  isVersionOutdated,
  type MobileAppRelease,
} from '../../services/mobileApp';
import styles from './MobileUpdateBanner.module.css';

/**
 * Détection d'app obsolète installée (ferme la boucle « toujours à jour ») :
 * au démarrage de l'app native (Capacitor), compare la version installée
 * (App.getInfo) à la dernière release publiée par la CI. Si une mise à jour
 * est disponible, affiche une bannière avec lien direct de téléchargement.
 *
 * Ne s'exécute QUE dans l'app native — jamais sur le web (là, c'est
 * MobileAppBanner qui propose l'installation).
 */
export default function MobileUpdateBanner() {
  const { t } = useTranslation();
  const [outdated, setOutdated] = useState(false);
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

  return (
    <div className={styles.banner} role="region" aria-label={t('mobileApp.update.ariaLabel')}>
      <div className={styles.content}>
        <p className={styles.title}>
          {t('mobileApp.update.title', { version: release.version })}
        </p>
        <p className={styles.subtitle}>{t('mobileApp.update.subtitle')}</p>
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
