import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ShieldCheck, Smartphone, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getDeviceOemInfo,
  openOemBatterySettings,
  type DeviceOemInfo,
} from '../../services/tracking/backgroundLocation';
import type { TrackingStatus } from '../../hooks/useDriverTracking';
import styles from './BatterySetupGuide.module.css';

const SEEN_FLAG = 'dt_battery_setup_seen';

const OEM_NAMES: Record<string, string> = {
  xiaomi: 'Xiaomi / Redmi / POCO (MIUI/HyperOS)',
  huawei: 'Huawei (EMUI)',
  honor: 'Honor (MagicOS)',
  oppo: 'Oppo (ColorOS)',
  vivo: 'Vivo (Funtouch/OriginOS)',
  oneplus: 'OnePlus (ColorOS)',
  realme: 'realme (realme UI)',
  samsung: 'Samsung (One UI)',
};

// Instructions manuelles par marque (surcouches agressives) — ce que l'utilisateur
// doit faire EN PLUS de l'exemption Android standard. Texte court, actionnable.
const OEM_STEPS: Record<string, string[]> = {
  xiaomi: [
    "Ouvrir Paramètres → Applications → Gérer les applications → LogiTrack",
    "Activer « Démarrage automatique » (Autostart) — sans lui, MIUI tue l'app même écran verrouillé",
    "Batterie → « Sans restriction »",
  ],
  huawei: [
    "Ouvrir Paramètres → Applications → LogiTrack",
    "Batterie → « Autoriser l'app à démarrer automatiquement et en arrière-plan »",
    "Paramètres → Batterie → Optimisation de la batterie → LogiTrack → « Ne pas optimiser »",
  ],
  honor: [
    "Ouvrir Paramètres → Applications → LogiTrack",
    "Batterie → autoriser l'activité en arrière-plan",
    "Désactiver l'optimisation batterie pour LogiTrack",
  ],
  oppo: [
    "Ouvrir Paramètres → Applications → LogiTrack",
    "« Autoriser l'activité en arrière-plan » (ColorOS 12+)",
    "Utilisation de la batterie → « Autoriser en arrière-plan »",
  ],
  vivo: [
    "Ouvrir Paramètres → Applications → Gérer les applications → LogiTrack",
    "Autorisation → tout activer",
    "Paramètres → Batterie → Applications en arrière-plan → autoriser LogiTrack",
  ],
  oneplus: [
    "Ouvrir Paramètres → Applications → LogiTrack",
    "« Autoriser l'activité en arrière-plan »",
    "Utilisation de la batterie → « Autoriser en arrière-plan »",
  ],
  realme: [
    "Ouvrir Paramètres → Applications → LogiTrack",
    "« Autoriser l'activité en arrière-plan »",
    "Paramètres → Batterie → « Autostart » → activer LogiTrack",
  ],
  samsung: [
    "Ouvrir Paramètres → Applications → LogiTrack → Batterie",
    "Activer « Autoriser en arrière-plan » et désactiver « Mettre en veille »",
  ],
};

/**
 * Guide de configuration batterie affiché UNE fois au chauffeur (premier lancement
 * sur Android) : explique pourquoi l'app a besoin de tourner en arrière-plan, puis
 * guide pas à pas :
 *  1. l'exemption d'optimisation batterie Android (bouton → écran système),
 *  2. les réglages manuels propres à la marque du téléphone (surcouches agressives
 *     type MIUI/EMUI/ColorOS — bouton → écran "démarrage automatique" si disponible).
 * C'est la cause n°1 du tracking qui s'arrête en arrière-plan : sans ces réglages,
 * le système tue l'app après quelques minutes d'écran verrouillé.
 *
 * Réaffichable depuis la bannière persistante (tant que batteryOptimizationIgnored
 * est false) ; ce guide-ci n'apparaît qu'une fois (localStorage dt_battery_setup_seen),
 * pour ne pas gêner le chauffeur au quotidien.
 */
export default function BatterySetupGuide({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();
  const [oem, setOem] = useState<DeviceOemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingOem, setOpeningOem] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getDeviceOemInfo()
      .then((info) => {
        if (!cancelled) setOem(info);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Affichage conditionnel :
  //  - Android uniquement (le plugin natif n'existe pas ailleurs),
  //  - non déjà affiché (flag localStorage),
  //  - pas tant que la détection de marque n'est pas terminée.
  if (Capacitor.getPlatform() !== 'android') return null;
  if (dismissedRef.current) return null;
  if (loading) return null;
  if (typeof window !== 'undefined' && window.localStorage.getItem(SEEN_FLAG) === '1') return null;

  const aggressive = oem?.aggressive === true;
  const oemName = (oem && OEM_NAMES[oem.oem]) || oem?.manufacturer || '';
  const steps = (oem && OEM_STEPS[oem.oem]) || [];

  const dismiss = () => {
    dismissedRef.current = true;
    try {
      window.localStorage.setItem(SEEN_FLAG, '1');
    } catch {}
  };

  const handleOemOpen = async () => {
    if (openingOem) return;
    setOpeningOem(true);
    try {
      await openOemBatterySettings();
    } catch {}
    // L'app passe en arrière-plan pour afficher l'écran système : on relâche
    // l'état au retour (le refresh batterie se fait via visibilitychange).
    setTimeout(() => setOpeningOem(false), 1500);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <button
          type="button"
          className={styles.closeBtn}
          aria-label={t('batterySetup.close', 'Fermer')}
          onClick={dismiss}
        >
          <X size={18} />
        </button>

        <div className={styles.header}>
          <span className={styles.iconChip}>
            <ShieldCheck size={18} />
          </span>
          <h2 className={styles.title}>{t('batterySetup.title', 'Gardez le suivi actif en arrière-plan')}</h2>
        </div>

        <p className={styles.message}>
          {t(
            'batterySetup.intro',
            "Votre téléphone peut mettre l'app en veille pour économiser la batterie, ce qui interrompt la transmission de votre position au dispatcher. Quelques réglages en 2 minutes suffisent pour que le suivi continue écran verrouillé.",
          )}
        </p>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <div className={styles.stepBody}>
              <span className={styles.stepTitle}>
                {t('batterySetup.stepBattery', 'Autoriser l\u2019exemption d\u2019optimisation batterie')}
              </span>
              <span className={styles.stepText}>
                {t(
                  'batterySetup.stepBatteryText',
                  "Ouvrir le réglage système et choisir « Sans restriction » (ou « Ne pas optimiser »).",
                )}
              </span>
              {status.batteryOptimizationIgnored ? (
                <span className={styles.doneChip}>
                  <Check size={13} /> {t('batterySetup.done', 'Réglé')}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => void status.requestBatteryExemption()}
                >
                  {t('batterySetup.openBattery', 'Ouvrir le réglage batterie')}
                </button>
              )}
            </div>
          </li>

          {aggressive && (
            <li className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>
                  <Smartphone size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                  {t('batterySetup.stepOem', 'Réglages spécifiques à votre téléphone')}
                </span>
                <span className={styles.stepText}>
                  {t('batterySetup.stepOemIntro', 'Votre téléphone ({brand}) a une gestion batterie renforcée. Ces réglages manuels sont indispensables.', { brand: oemName || oem?.model || '' })}
                </span>
                {steps.length > 0 && (
                  <ul className={styles.oemSteps}>
                    {steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={styles.actionBtn}
                  disabled={openingOem}
                  onClick={() => void handleOemOpen()}
                >
                  {openingOem
                    ? t('batterySetup.opening', 'Ouverture…')
                    : t('batterySetup.openOem', 'Ouvrir le réglage constructeur')}
                </button>
              </div>
            </li>
          )}
        </ol>

        <div className={styles.footer}>
          <button type="button" className={styles.dismissBtn} onClick={dismiss}>
            {t('batterySetup.dismiss', 'J\u2019ai compris, plus tard')}
          </button>
        </div>
      </div>
    </div>
  );
}
