import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import Input from './Input';
import Badge from './Badge';
import { useToast } from './Toast';
import api from '../services/api/client';
import type { MaintenanceSchedule } from '../types';
import styles from './VehicleMaintenanceModal.module.css';

type ApiError = { response?: { data?: { message?: string } } };

interface Props {
  vehicleId: string;
  vehicleLabel: string;
  open: boolean;
  onClose: () => void;
}

const STATUS_VARIANT: Record<MaintenanceSchedule['status'], 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  upcoming: 'warning',
  overdue: 'danger',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TFunction i18next a un typage générique trop strict pour un helper local prenant `t` en paramètre
function formatRemaining(schedule: MaintenanceSchedule, t: (k: string, o?: any) => string) {
  const parts: string[] = [];
  if (schedule.kmRemaining != null) {
    parts.push(
      schedule.kmRemaining <= 0
        ? t('fleet.maintenance.overdueKm', { km: Math.abs(Math.round(schedule.kmRemaining)) })
        : t('fleet.maintenance.remainingKm', { km: Math.round(schedule.kmRemaining) }),
    );
  }
  if (schedule.daysRemaining != null) {
    parts.push(
      schedule.daysRemaining <= 0
        ? t('fleet.maintenance.overdueDays', { days: Math.abs(schedule.daysRemaining) })
        : t('fleet.maintenance.remainingDays', { days: schedule.daysRemaining }),
    );
  }
  return parts.join(' · ');
}

export default function VehicleMaintenanceModal({ vehicleId, vehicleLabel, open, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('');
  const [intervalKm, setIntervalKm] = useState('');
  const [intervalMonths, setIntervalMonths] = useState('');

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['maintenance-schedules', vehicleId],
    queryFn: () =>
      api.get<MaintenanceSchedule[]>(`/vehicles/${vehicleId}/maintenance-schedules`).then((r) => r.data),
    enabled: open,
  });

  const resetForm = () => {
    setLabel('');
    setType('');
    setIntervalKm('');
    setIntervalMonths('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/vehicles/${vehicleId}/maintenance-schedules`, {
        label,
        type,
        ...(intervalKm ? { intervalKm: Number(intervalKm) } : {}),
        ...(intervalMonths ? { intervalMonths: Number(intervalMonths) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-schedules', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-due-soon'] });
      toast(t('fleet.maintenance.toast.created'));
      resetForm();
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fleet.maintenance.toast.error'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance-schedules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-schedules', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-due-soon'] });
      toast(t('fleet.maintenance.toast.deleted'));
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fleet.maintenance.toast.error'), 'error');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createMutation.isPending) return;
    if (!label.trim() || !type.trim() || (!intervalKm && !intervalMonths)) {
      toast(t('fleet.maintenance.missingFields'), 'error');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('fleet.maintenance.title', { vehicle: vehicleLabel })} width={560}>
      <div className={styles.container}>
        {isLoading ? (
          <p className={styles.loading}>{t('common.loading')}</p>
        ) : schedules && schedules.length > 0 ? (
          <ul className={styles.list}>
            {schedules.map((s) => (
              <li key={s.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemLabel}>{s.label}</span>
                  <span className={styles.itemInterval}>
                    {s.intervalKm ? t('fleet.maintenance.everyKm', { km: s.intervalKm }) : null}
                    {s.intervalKm && s.intervalMonths ? ' · ' : null}
                    {s.intervalMonths ? t('fleet.maintenance.everyMonths', { months: s.intervalMonths }) : null}
                  </span>
                </div>
                <div className={styles.itemStatus}>
                  <Badge variant={STATUS_VARIANT[s.status]} size="sm" icon={s.status === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}>
                    {t(`fleet.maintenance.status.${s.status}`)}
                  </Badge>
                  <span className={styles.itemRemaining}>{formatRemaining(s, t)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(s.id)}
                  disabled={deleteMutation.isPending}
                  className={styles.deleteBtn}
                  aria-label={t('fleet.maintenance.deleteAria', { label: s.label })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t('fleet.maintenance.empty')}</p>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <h3 className={styles.formTitle}>{t('fleet.maintenance.addTitle')}</h3>
          <Input
            label={t('fleet.maintenance.fields.label')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('fleet.maintenance.fields.labelPlaceholder')}
            fullWidth
          />
          <Input
            label={t('fleet.maintenance.fields.type')}
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder={t('fleet.maintenance.fields.typePlaceholder')}
            hint={t('fleet.maintenance.fields.typeHint')}
            fullWidth
          />
          <div className={styles.formRow}>
            <Input
              type="number"
              min={1}
              label={t('fleet.maintenance.fields.intervalKm')}
              value={intervalKm}
              onChange={(e) => setIntervalKm(e.target.value)}
              placeholder="5000"
            />
            <Input
              type="number"
              min={1}
              label={t('fleet.maintenance.fields.intervalMonths')}
              value={intervalMonths}
              onChange={(e) => setIntervalMonths(e.target.value)}
              placeholder="6"
            />
          </div>
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={createMutation.isPending} fullWidth>
            {createMutation.isPending ? t('common.loading') : t('fleet.maintenance.add')}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
