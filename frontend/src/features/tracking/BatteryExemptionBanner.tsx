import { BatteryWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrackingStatus } from '../../hooks/useDriverTracking';
import styles from './BatteryExemptionBanner.module.css';

// Bannière PERSISTANTE tant que l'exemption d'optimisation batterie n'est pas accordée
// (Android). Montrée sur toutes les pages chauffeur via DriverTrackingWrapper : le
// champ batteryOptimizationIgnored est relu au démarrage du tracking et à chaque retour
// au premier plan, donc la bannière disparaît dès que l'utilisateur accorde l'exemption
// (y compris manuellement via les réglages constructeur type MIUI — docs/android-battery-settings.md).
export default function BatteryExemptionBanner({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();

  if (status.batteryOptimizationIgnored) return null;

  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <span className={styles.iconChip}>
          <BatteryWarning size={15} />
        </span>
        <div className={styles.title}>
          {t('batteryExemption.title', 'Optimisation batterie active')}
        </div>
      </div>
      <p className={styles.message}>
        {t(
          'batteryExemption.message',
          "Sans cette autorisation, votre position peut cesser d'être transmise si le téléphone met l'app en veille.",
        )}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => void status.requestBatteryExemption()}
        >
          {t('batteryExemption.allow', "Autoriser l'app à fonctionner en arrière-plan")}
        </button>
      </div>
      <button type="button" className={styles.hintLink}>
        {t(
          'batteryExemption.manualHint',
          'Certains téléphones (Xiaomi/MIUI…) exigent des réglages manuels supplémentaires',
        )}
      </button>
    </div>
  );
}
