import { useRef, useState } from 'react';
import { BatteryWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrackingStatus } from '../../hooks/useDriverTracking';
import styles from './BatteryExemptionBanner.module.css';

// Anti-boucle : après une tentative d'ouverture des réglages, on attend ce délai avant
// de permettre un nouvel appui. Si l'exemption n'est pas accordée au retour (surcouches
// MIUI/Samsung), la bannière reste mais ne "boucle" pas sur un re-clic immédiat.
const PROMPT_COOLDOWN_MS = 8000;

// Bannière PERSISTANTE tant que l'exemption d'optimisation batterie n'est pas accordée
// (Android). Montrée sur toutes les pages chauffeur via DriverTrackingWrapper : le
// champ batteryOptimizationIgnored est relu au démarrage du tracking et à chaque retour
// au premier plan, donc la bannière disparaît dès que l'utilisateur accorde l'exemption
// (y compris manuellement via les réglages constructeur type MIUI — docs/android-battery-settings.md).
export default function BatteryExemptionBanner({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const lastPromptRef = useRef(0);

  if (status.batteryOptimizationIgnored) return null;

  const handleOpen = async () => {
    const now = Date.now();
    // Anti-boucle : ignore un appui trop rapproché du précédent (l'utilisateur revient
    // de l'écran système sans que l'exemption soit accordée → pas de re-ouverture en boucle).
    if (opening || now - lastPromptRef.current < PROMPT_COOLDOWN_MS) return;
    lastPromptRef.current = now;
    setOpening(true);
    try {
      await status.requestBatteryExemption();
    } catch (err) {
      console.warn('[batteryExemption] open failed:', err);
    } finally {
      // L'app passe en arrière-plan pour afficher l'écran système : on relâche l'état
      // au retour (le refresh via visibilitychange mettra à jour batteryOptimizationIgnored).
      setTimeout(() => setOpening(false), 1500);
    }
  };

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
          disabled={opening}
          onClick={() => void handleOpen()}
        >
          {opening
            ? t('batteryExemption.opening', 'Ouverture des réglages…')
            : t('batteryExemption.allow', "Autoriser l'app à fonctionner en arrière-plan")}
        </button>
      </div>
      <p className={styles.hintLink}>
        {t(
          'batteryExemption.manualHint',
          'Certains téléphones (Xiaomi/MIUI…) exigent des réglages manuels supplémentaires',
        )}
      </p>
    </div>
  );
}
