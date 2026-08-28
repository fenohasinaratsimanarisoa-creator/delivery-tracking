import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, Circle, NavigationOff, AlertTriangle, Wrench } from 'lucide-react';
import styles from './VehicleStatusPill.module.css';

/**
 * Statut opérationnel d'un véhicule. Distingué par la FORME de l'icône + le
 * libellé, jamais par la seule couleur (marqueurs carte, panneau, légende,
 * liste Flotte). Les couleurs viennent des tokens `--status-*` (theme.ts).
 */
export type VehicleStatus = 'enroute' | 'idle' | 'offline' | 'alert' | 'maintenance';

/** Statut brut du flux carte (`VehicleData.status`) → statut sémantique du pill. */
export function mapVehicleStatus(raw: 'moving' | 'static' | 'offline' | string): VehicleStatus {
  if (raw === 'moving') return 'enroute';
  if (raw === 'offline') return 'offline';
  return 'idle';
}

const ICONS: Record<VehicleStatus, typeof Navigation> = {
  enroute: Navigation,
  idle: Circle,
  offline: NavigationOff,
  alert: AlertTriangle,
  maintenance: Wrench,
};

const VARIANT_CLASS: Record<VehicleStatus, string> = {
  enroute: styles.enroute,
  idle: styles.idle,
  offline: styles.offline,
  alert: styles.alert,
  maintenance: styles.maintenance,
};

interface Props {
  status: VehicleStatus;
  size?: 'sm' | 'md';
  /** Remplace le libellé i18n par défaut (`vehicleStatus.<status>`). */
  label?: ReactNode;
  /** Masque le texte, ne garde que l'icône (le libellé passe en `aria-label`/`title`). */
  iconOnly?: boolean;
  className?: string;
}

export default function VehicleStatusPill({ status, size = 'md', label, iconOnly, className }: Props) {
  const { t } = useTranslation();
  const Icon = ICONS[status];
  const text = label ?? t(`vehicleStatus.${status}`);
  const iconPx = size === 'sm' ? 11 : 12;

  return (
    <span
      className={[
        styles.root,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        VARIANT_CLASS[status],
        iconOnly ? styles.iconOnly : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={iconOnly && typeof text === 'string' ? text : undefined}
      aria-label={iconOnly && typeof text === 'string' ? text : undefined}
    >
      <Icon size={iconPx} strokeWidth={2} aria-hidden="true" className={styles.icon} />
      {!iconOnly && <span className={styles.label}>{text}</span>}
    </span>
  );
}
