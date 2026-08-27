import { useRef, useState } from 'react';
import { BatteryWarning, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrackingStatus } from '../../hooks/useDriverTracking';
import styles from './BatteryExemptionBanner.module.css';

// Anti-boucle : après une tentative d'ouverture des réglages, on attend ce délai avant
// de permettre un nouvel appui. Si l'exemption n'est pas accordée au retour (surcouches
// MIUI/Samsung), la bannière reste mais ne "boucle" pas sur un re-clic immédiat.
const PROMPT_COOLDOWN_MS = 8000;

// BUG CORRIGÉ (audit terrain 2026-08-27, cause racine de coupures de tracking de
// 1h30-2h confirmées malgré l'exemption Android déjà accordée) : cette clé permet à
// l'utilisateur de masquer DÉFINITIVEMENT la section réglages constructeur une fois
// qu'il les a configurés — Android n'expose AUCUNE API pour détecter programmatiquement
// si l'autostart/l'économie d'énergie MIUI sont réellement activés (contrairement à
// batteryOptimizationIgnored, qui EST détectable). Sans ce dismiss, la section
// resterait affichée en permanence pour tout appareil Xiaomi/EMUI/ColorOS/Vivo, même
// après configuration correcte.
const OEM_DISMISS_KEY = 'dt_oem_settings_dismissed';

// Bannière batterie PERSISTANTE tant que l'exemption d'optimisation batterie n'est pas
// accordée (Android). Montrée sur toutes les pages chauffeur via DriverTrackingWrapper :
// le champ batteryOptimizationIgnored est relu au démarrage du tracking et à chaque
// retour au premier plan, donc cette section disparaît dès que l'utilisateur accorde
// l'exemption (y compris manuellement via les réglages système).
//
// BUG CORRIGÉ (audit terrain 2026-08-27) : la section réglages constructeur (autostart +
// économie d'énergie MIUI) était imbriquée DANS cette bannière, donc cachée dès que
// batteryOptimizationIgnored passait à true — alors que ces réglages MIUI sont
// INDÉPENDANTS de l'exemption Android standard et tout aussi nécessaires. Cas réel :
// exemption Android accordée + autostart accordé, mais économie d'énergie MIUI restée
// sur sa valeur par défaut → 3 coupures de tracking de 1h30-2h en une seule journée
// (watchdog WorkManager lui-même gelé par ce réglage). La section OEM est désormais
// AFFICHÉE INDÉPENDAMMENT (jamais liée à batteryOptimizationIgnored), avec un bouton
// dédié pour CHAQUE écran système requis, et un dismiss explicite (aucune détection
// automatique possible).
export default function BatteryExemptionBanner({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const lastPromptRef = useRef(0);
  const [oemDismissed, setOemDismissed] = useState(() => {
    try {
      return localStorage.getItem(OEM_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const handleOpen = async (
    action: () => Promise<unknown>,
    onFailLog: string,
  ) => {
    const now = Date.now();
    // Anti-boucle : ignore un appui trop rapproché du précédent (l'utilisateur revient
    // de l'écran système sans que le réglage soit accordé → pas de re-ouverture en boucle).
    if (opening || now - lastPromptRef.current < PROMPT_COOLDOWN_MS) return;
    lastPromptRef.current = now;
    setOpening(true);
    try {
      await action();
    } catch (err) {
      console.warn(`[batteryExemption] ${onFailLog} failed:`, err);
    } finally {
      // L'app passe en arrière-plan pour afficher l'écran système : on relâche l'état
      // au retour (le refresh via visibilitychange mettra à jour batteryOptimizationIgnored).
      setTimeout(() => setOpening(false), 1500);
    }
  };

  const dismissOemSection = () => {
    setOemDismissed(true);
    try {
      localStorage.setItem(OEM_DISMISS_KEY, '1');
    } catch {
      /* quota/mode privé : le dismiss ne survivra pas au rechargement, sans conséquence grave */
    }
  };

  const showBatteryBanner = !status.batteryOptimizationIgnored;
  const showOemSection = status.deviceOem?.aggressive && !oemDismissed;

  if (!showBatteryBanner && !showOemSection) return null;

  return (
    <>
      {showBatteryBanner && (
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
              onClick={() => void handleOpen(status.requestBatteryExemption, 'battery exemption')}
            >
              {opening
                ? t('batteryExemption.opening', 'Ouverture des réglages…')
                : t('batteryExemption.allow', "Autoriser l'app à fonctionner en arrière-plan")}
            </button>
          </div>
        </div>
      )}
      {showOemSection && (
        <div className={styles.banner}>
          <div className={styles.header}>
            <span className={styles.iconChip}>
              <Smartphone size={15} />
            </span>
            <div className={styles.title}>
              {t('batteryExemption.oemTitle', 'Réglages {{brand}} supplémentaires', {
                brand: status.deviceOem?.model || status.deviceOem?.manufacturer || '',
              })}
            </div>
          </div>
          <p className={styles.message}>
            {t(
              'batteryExemption.oemMessage',
              "Certains téléphones exigent des réglages manuels EN PLUS de l'autorisation ci-dessus, sinon le suivi peut s'interrompre pendant 1 à 2 heures sans prévenir.",
            )}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={opening}
              onClick={() => void handleOpen(status.openOemSettings, 'oem autostart')}
            >
              <Smartphone size={14} />
              {t('batteryExemption.oemAutostart', 'Démarrage automatique')}
            </button>
            {status.deviceOem?.hasBatterySaverScreen && (
              <button
                type="button"
                className={styles.actionBtn}
                disabled={opening}
                onClick={() =>
                  void handleOpen(status.openOemBatterySaverSettings, 'oem battery saver')
                }
              >
                <BatteryWarning size={14} />
                {t('batteryExemption.oemBatterySaver', "Économie d'énergie")}
              </button>
            )}
          </div>
          <p className={styles.hintLink}>
            {t(
              'batteryExemption.oemHint',
              'Choisissez "Sans restriction" / "Autoriser" sur chaque écran qui s\'ouvre.',
            )}{' '}
            <button type="button" className={styles.dismissLink} onClick={dismissOemSection}>
              {t('batteryExemption.oemDismiss', "C'est déjà fait, ne plus afficher")}
            </button>
          </p>
        </div>
      )}
    </>
  );
}
