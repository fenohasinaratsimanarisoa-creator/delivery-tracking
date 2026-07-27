import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Truck } from 'lucide-react';
import api from '../services/api/client';
import styles from './MyVehiclePage.module.css';

interface DriverProfile {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  isActive: boolean;
  vehicle?: {
    id: string;
    brand: string;
    model: string;
    year: number;
    licensePlate: string;
    fuelType: string;
    positionSource?: string;
  };
}

export default function MyVehiclePage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api.get('/drivers/profile').then((r) => r.data),
  });

  const profile = data as DriverProfile | undefined;
  const vehicle = profile?.vehicle;

  if (isLoading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
        <div className={styles.loadingSkeleton} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.emptyState}>
        <h1 className={styles.emptyStateTitle}>{t('myVehicle.title')}</h1>
        <p>{t('myVehicle.noDriverProfile')}</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
        <div className={styles.noVehicleCard}>
          <Truck size={48} className={styles.noVehicleIcon} />
          <p className={styles.noVehicleText}>{t('myVehicle.noVehicle')}</p>
          <p className={styles.noVehicleSubtext}>{t('myVehicle.contactAdmin')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>

      <div className={styles.vehicleCard}>
        <div className={styles.vehicleHeader}>
          <Truck size={32} />
          <div>
            <div className={styles.vehicleName}>{vehicle.brand} {vehicle.model}</div>
            <div className={styles.vehiclePlate}>{vehicle.licensePlate}</div>
          </div>
        </div>

        <div className={styles.vehicleBody}>
          <Row label={t('myVehicle.fields.brand')} value={vehicle.brand} />
          <Row label={t('myVehicle.fields.model')} value={vehicle.model} />
          <Row label={t('myVehicle.fields.year')} value={String(vehicle.year)} />
          <Row label={t('myVehicle.fields.licensePlate')} value={vehicle.licensePlate} />
          <Row label={t('myVehicle.fields.fuelType')} value={vehicle.fuelType} />
      <Row label="Suivi GPS" value={vehicle.positionSource === 'physical_tracker' ? 'Traceur GPS physique' : 'Application mobile'} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>{label}</div>
      <div className={styles.rowValue}>{value}</div>
    </div>
  );
}