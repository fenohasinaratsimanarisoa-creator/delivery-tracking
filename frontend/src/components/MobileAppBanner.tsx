import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/AuthContext';
import {
  fetchLatestMobileApp,
  hasDismissedMobileAppBanner,
  dismissMobileAppBanner,
  type MobileAppRelease,
} from '../services/mobileApp';
import styles from './MobileAppBanner.module.css';

/**
 * Bannière d'installation de l'app chauffeur (APK).
 *
 * - Version et URL TOUJOURS dynamiques : lues depuis GET /api/mobile-app/latest
 *   (source de vérité = la dernière GitHub Release buildée par la CI). Rien de
 *   codé en dur : si le build CI change la version, la bannière la reflète au
 *   prochain chargement.
 * - Ciblée : chauffeurs (qui se connectent au web par erreur) + admin/dispatcher
 *   (qui gèrent les chauffeurs). Jamais pour un visiteur non connecté ni pour
 *   un client.
 * - Non intrusive : masquée durablement dès que l'utilisateur clique
 *   « J'ai déjà l'app » (localStorage). Pas de re-proposition en boucle.
 * - Silencieuse si aucune release n'existe encore (404) : jamais de faux « à jour ».
 */
export default function MobileAppBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [release, setRelease] = useState<MobileAppRelease | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const shouldShow =
    user &&
    (user.role === 'driver' || user.role === 'admin' || user.role === 'dispatcher');

  useEffect(() => {
    if (!shouldShow) return;
    let cancelled = false;
    fetchLatestMobileApp().then((r) => {
      if (!cancelled) setRelease(r);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldShow]);

  const onDismiss = useCallback(() => {
    dismissMobileAppBanner();
    setDismissed(true);
  }, []);

  if (!shouldShow || dismissed || !release) return null;
  // Déjà masquée pour cet utilisateur lors d'une visite précédente.
  if (hasDismissedMobileAppBanner()) return null;

  return (
    <div className={styles.banner} role="region" aria-label={t('mobileApp.banner.ariaLabel')}>
      <div className={styles.content}>
        <p className={styles.title}>
          {t('mobileApp.banner.title', { version: release.version })}
        </p>
        <p className={styles.subtitle}>{t('mobileApp.banner.subtitle')}</p>
        {release.changelog ? (
          <p className={styles.changelog} title={release.changelog}>
            {release.changelog.split('\n')[0]}
          </p>
        ) : null}
      </div>
      <div className={styles.actions}>
        <a
          className={styles.downloadLink}
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('mobileApp.banner.download', { version: release.version })}
        </a>
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          {t('mobileApp.banner.haveIt')}
        </button>
      </div>
    </div>
  );
}
