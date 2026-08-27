import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { MessageSquareWarning, Radio, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import {
  requestSmsPermission,
  setSmsGatewayNumber,
  getSmsFallbackStatus,
  requestSmsReceivePermission,
  setGatewayMode,
  getGatewayModeStatus,
} from '../../services/tracking/backgroundLocation';
import { getAbsoluteApiBaseUrl } from '../../services/api/config';
import styles from './SmsFallbackSettings.module.css';

/**
 * Réglages du canal de secours SMS zéro-connectivité (audit terrain
 * 2026-08-27) — voir SmsFallbackManager.java / GatewaySmsReceiver.java côté
 * natif pour le mécanisme complet.
 *
 * DEUX sections indépendantes, selon le rôle de l'utilisateur connecté sur
 * CE téléphone :
 *  - Chauffeur : configure le numéro du téléphone-passerelle vers lequel SON
 *    téléphone enverra un SMS de secours (throttlé) quand la synchronisation
 *    normale échoue depuis plus de 10 minutes.
 *  - Admin/dispatcher : active CE téléphone comme passerelle (reçoit les SMS
 *    de tous les chauffeurs, les relaie au serveur) — un seul téléphone-
 *    passerelle par entreprise, fixe, avec sa propre connexion internet.
 *    Nécessite une clé API scopée 'tracking:sms-relay' (créée séparément,
 *    voir la gestion des clés API).
 */
export default function SmsFallbackSettings() {
  const { user } = useAuth();

  if (Capacitor.getPlatform() !== 'android') return null;

  return (
    <div className={styles.wrapper}>
      {user?.role === 'driver' && <DriverSmsFallbackCard />}
      {(user?.role === 'admin' || user?.role === 'dispatcher') && <GatewayModeCard />}
    </div>
  );
}

function DriverSmsFallbackCard() {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSmsFallbackStatus()
      .then((s) => {
        if (cancelled) return;
        setNumber(s.gatewayNumber);
        setPermissionGranted(s.smsPermissionGranted);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!permissionGranted) {
        const granted = await requestSmsPermission();
        setPermissionGranted(granted);
      }
      await setSmsGatewayNumber(number.trim());
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.iconChip}>
          <MessageSquareWarning size={16} />
        </span>
        <div className={styles.title}>
          {t('smsFallback.driverTitle', 'Secours SMS sans connexion')}
        </div>
      </div>
      <p className={styles.message}>
        {t(
          'smsFallback.driverMessage',
          "Si vous perdez data ET WiFi pendant plus de 10 minutes, votre téléphone peut envoyer votre position par SMS à un téléphone-passerelle (au bureau). Renseignez son numéro pour l'activer.",
        )}
      </p>
      <div className={styles.row}>
        <input
          type="tel"
          className={styles.input}
          placeholder={t('smsFallback.numberPlaceholder', 'Numéro du téléphone-passerelle')}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <button type="button" className={styles.saveBtn} disabled={saving} onClick={() => void handleSave()}>
          {saving ? t('smsFallback.saving', 'Enregistrement…') : t('smsFallback.save', 'Enregistrer')}
        </button>
      </div>
      {permissionGranted ? (
        <span className={styles.doneChip}>
          <Check size={12} /> {t('smsFallback.permissionGranted', "Autorisation d'envoi de SMS accordée")}
        </span>
      ) : (
        <p className={styles.hint}>
          {t('smsFallback.permissionHint', "L'autorisation d'envoi de SMS sera demandée à l'enregistrement.")}
        </p>
      )}
    </div>
  );
}

function GatewayModeCard() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getGatewayModeStatus()
      .then((s) => {
        if (cancelled) return;
        setEnabled(s.enabled);
        setPermissionGranted(s.smsReceivePermissionGranted);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    try {
      if (next && !permissionGranted) {
        const granted = await requestSmsReceivePermission();
        setPermissionGranted(granted);
        if (!granted) {
          setSaving(false);
          return;
        }
      }
      await setGatewayMode(next, next ? getAbsoluteApiBaseUrl() : undefined, next ? apiKey.trim() : undefined);
      setEnabled(next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.iconChip}>
          <Radio size={16} />
        </span>
        <div className={styles.title}>
          {t('smsFallback.gatewayTitle', 'Ce téléphone comme passerelle SMS')}
        </div>
      </div>
      <p className={styles.message}>
        {t(
          'smsFallback.gatewayMessage',
          "Un SEUL téléphone par entreprise, fixe, avec sa propre connexion internet — il reçoit les SMS de secours des chauffeurs et les relaie automatiquement au serveur. Nécessite une clé API dédiée (scope tracking:sms-relay).",
        )}
      </p>
      {!enabled && (
        <div className={styles.row}>
          <input
            type="password"
            className={styles.input}
            placeholder={t('smsFallback.apiKeyPlaceholder', 'Clé API (scope tracking:sms-relay)')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      )}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.saveBtn}
          disabled={saving || (!enabled && !apiKey.trim())}
          onClick={() => void handleToggle(!enabled)}
        >
          {saving
            ? t('smsFallback.saving', 'Enregistrement…')
            : enabled
              ? t('smsFallback.disableGateway', 'Désactiver le mode passerelle')
              : t('smsFallback.enableGateway', 'Activer le mode passerelle')}
        </button>
      </div>
      {enabled && (
        <span className={styles.doneChip}>
          <Check size={12} /> {t('smsFallback.gatewayActive', 'Mode passerelle actif sur ce téléphone')}
        </span>
      )}
    </div>
  );
}
