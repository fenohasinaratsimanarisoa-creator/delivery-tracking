import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Truck, Fuel, CalendarRange, Tag, Cpu, Smartphone, Factory, Flag,
} from 'lucide-react';import api from '../services/api/client';
import styles from './MyVehiclePage.module.css';

interface VehicleDto {
  id: string;
  brand: string;
  model: string;
  year: number;
  licensePlate: string;
  fuelType: string;
  positionSource?: string;
}

interface DriverProfile {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  isActive: boolean;
  vehicle?: VehicleDto;
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
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}><Truck size={18} /></div>
            <div>
              <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
              <p className={styles.pageSubtitle}>{t('myVehicle.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className={styles.loadingSkeleton} />
        <div className={`${styles.loadingSkeleton} ${styles.skeletonHalf}`} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}><Truck size={18} /></div>
            <div>
              <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
            </div>
          </div>
        </div>
        <div className={styles.emptyState}>
          <h1 className={styles.emptyStateTitle}>{t('myVehicle.title')}</h1>
          <p className={styles.emptyStateText}>{t('myVehicle.noDriverProfile')}</p>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}><Truck size={18} /></div>
            <div>
              <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
              <p className={styles.pageSubtitle}>{t('myVehicle.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className={styles.noVehicleCard}>
          <div className={styles.noVehicleIcon}><Truck size={48} /></div>
          <p className={styles.noVehicleText}>{t('myVehicle.noVehicle')}</p>
          <p className={styles.noVehicleSubtext}>{t('myVehicle.contactAdmin')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerTop}>
          <div className={styles.titleIconChip}><Truck size={18} /></div>
          <div>
            <h1 className={styles.pageTitle}>{t('myVehicle.title')}</h1>
            <p className={styles.pageSubtitle}>{t('myVehicle.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className={styles.vehicleCard}>
        <div className={styles.vehicleGlow} />
        <div className={styles.vehicleHeader}>
          <div className={styles.vehicleIcon}>
            <Truck size={30} />
          </div>
          <div className={styles.vehicleIdentity}>
            <div className={styles.vehicleName}>{vehicle.brand} {vehicle.model}</div>
            <div className={styles.plateRow}>
              <span className={styles.vehiclePlate}>{vehicle.licensePlate}</span>
              <span className={styles.yearChip}>{vehicle.year}</span>
            </div>
          </div>
          <span className={styles.positionBadge}>
            {vehicle.positionSource === 'physical_tracker'
              ? <Cpu size={12} />
              : <Smartphone size={12} />}
            {vehicle.positionSource === 'physical_tracker'
              ? t('myVehicle.positionSource.physicalTracker')
              : t('myVehicle.positionSource.mobileApp')}
          </span>
        </div>

        <div className={styles.vehicleBody}>
          <SpecTile icon={<Factory size={15} />} label={t('myVehicle.fields.brand')} value={vehicle.brand} />
          <SpecTile icon={<Flag size={15} />} label={t('myVehicle.fields.model')} value={vehicle.model} />
          <SpecTile icon={<CalendarRange size={15} />} label={t('myVehicle.fields.year')} value={String(vehicle.year)} />
          <SpecTile icon={<Tag size={15} />} label={t('myVehicle.fields.licensePlate')} value={vehicle.licensePlate} mono />
          <SpecTile icon={<Fuel size={15} />} label={t('myVehicle.fields.fuelType')} value={vehicle.fuelType} />
          <SpecTile
            icon={vehicle.positionSource === 'physical_tracker' ? <Cpu size={15} /> : <Smartphone size={15} />}
            label={t('myVehicle.fields.positionSource')}
            value={vehicle.positionSource === 'physical_tracker'
              ? t('myVehicle.positionSource.physicalTracker')
              : t('myVehicle.positionSource.mobileApp')}
          />
        </div>
      </div>
    </div>
  );
}

function SpecTile({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.specTile}>
      <div className={styles.specIcon}>{icon}</div>
      <div className={styles.specText}>
        <div className={styles.specLabel}>{label}</div>
        <div className={`${styles.specValue}${mono ? ` ${styles.specMono}` : ''}`}>{value}</div>
      </div>
    </div>
  );
}