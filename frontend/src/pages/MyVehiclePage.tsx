import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Truck } from 'lucide-react';
import api from '../services/api/client';

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
      <div style={{
        padding: 'var(--space-2xl, 32px)',
        background: 'var(--color-bg, #0B1220)',
        minHeight: '100vh',
      }}>
        <h1 style={{ color: 'var(--color-text, #E8ECF3)', marginBottom: 'var(--space-lg, 16px)' }}>{t('myVehicle.title')}</h1>
        <div style={{
          height: 300, background: 'var(--color-skeleton, rgba(255,255,255,0.04))',
          borderRadius: 'var(--radius-lg, 8px)', animation: 'dt-shimmer 1.5s infinite linear',
          backgroundImage: 'linear-gradient(90deg, var(--color-skeleton, rgba(255,255,255,0.04)) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton, rgba(255,255,255,0.04)) 75%)',
          backgroundSize: '200% 100%',
        }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{
        padding: 'var(--space-2xl, 32px)', textAlign: 'center',
        color: 'var(--color-text-tertiary, #7A8BA3)',
        background: 'var(--color-bg, #0B1220)', minHeight: '100vh',
      }}>
        <h1 style={{ color: 'var(--color-text, #E8ECF3)' }}>{t('myVehicle.title')}</h1>
        <p>{t('myVehicle.noDriverProfile')}</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={{
        padding: 'var(--space-2xl, 32px)',
        background: 'var(--color-bg, #0B1220)', minHeight: '100vh',
      }}>
        <h1 style={{ color: 'var(--color-text, #E8ECF3)', marginBottom: 'var(--space-lg, 16px)' }}>{t('myVehicle.title')}</h1>
        <div style={{
          background: 'var(--color-surface, #121B2E)', borderRadius: 'var(--radius-xl, 12px)',
          padding: 40, textAlign: 'center',
          border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
        }}>
          <Truck size={48} style={{ marginBottom: 12, color: 'var(--color-text-tertiary, #7A8BA3)' }} />
          <p style={{ fontSize: '1.1rem', color: 'var(--color-text, #E8ECF3)' }}>{t('myVehicle.noVehicle')}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary, #9BA6B9)' }}>{t('myVehicle.contactAdmin')}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 'var(--space-2xl, 32px)',
      background: 'var(--color-bg, #0B1220)', minHeight: '100vh',
    }}>
      <h1 style={{
        color: 'var(--color-text, #E8ECF3)',
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
        fontSize: 'var(--text-2xl, 1.5rem)',
        fontWeight: 700,
        marginBottom: 'var(--space-xl, 20px)',
      }}>
        {t('myVehicle.title')}
      </h1>

      <div style={{
        background: 'var(--color-surface, #121B2E)',
        borderRadius: 'var(--radius-xl, 12px)',
        overflow: 'hidden',
        border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--color-accent, #F2A93C), #d4902e)',
          color: 'var(--color-bg, #0B1220)',
          padding: 'var(--space-xl, 20px) var(--space-2xl, 24px)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Truck size={32} />
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{vehicle.brand} {vehicle.model}</div>
            <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{vehicle.licensePlate}</div>
          </div>
        </div>

        <div style={{ padding: 'var(--space-2xl, 24px)' }}>
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
    <div style={{
      display: 'flex', padding: 'var(--space-sm, 10px) 0',
      borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      fontSize: 'var(--text-sm, 0.9rem)',
    }}>
      <div style={{
        width: 160, color: 'var(--color-text-tertiary, #7A8BA3)',
        fontWeight: 500, flexShrink: 0,
      }}>{label}</div>
      <div style={{ color: 'var(--color-text, #E8ECF3)' }}>{value}</div>
    </div>
  );
}