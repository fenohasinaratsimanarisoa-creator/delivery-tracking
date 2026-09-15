import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Package, Truck, Zap, Building2, Upload } from 'lucide-react';
import api from '../../services/api/client';
import { useAuth } from '../../hooks/AuthContext';
import { useToast } from '../../components/Toast';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { formatAriary } from '../../services/formatAriary';
import { formatDate } from '../../services/i18n/formatDate';
import type { BillingPlan, PlatformPaymentMethod, PaymentProof } from '../../types';
import styles from './PaywallPage.module.css';

const PLAN_ICONS: Record<string, React.ReactNode> = {
  starter: <Truck size={26} />,
  pro: <Zap size={26} />,
  enterprise: <Building2 size={26} />,
};

const PROVIDER_LABEL: Record<string, string> = {
  mvola: 'Mvola',
  orange_money: 'Orange Money',
};

export default function PaywallPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: plans } = useQuery({
    queryKey: ['manual-billing-plans'],
    queryFn: () => api.get<BillingPlan[]>('/manual-billing/plans').then((r) => r.data),
  });

  const { data: methods } = useQuery({
    queryKey: ['manual-billing-payment-methods'],
    queryFn: () => api.get<PlatformPaymentMethod[]>('/manual-billing/payment-methods').then((r) => r.data),
  });

  const { data: myProofs } = useQuery({
    queryKey: ['manual-billing-proofs-mine'],
    queryFn: () => api.get<PaymentProof[]>('/manual-billing/proofs/mine').then((r) => r.data),
    enabled: isAdmin,
  });

  const latestProof = myProofs?.[0];
  const hasPendingProof = latestProof?.status === 'pending';

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!selectedPlanId || !selectedMethodId) throw new Error('missing');
      const file = fileInputRef.current?.files?.[0];
      if (!file) throw new Error('missing file');
      const formData = new FormData();
      formData.append('claimedPlanId', selectedPlanId);
      formData.append('paymentMethodId', selectedMethodId);
      formData.append('reference', reference);
      formData.append('image', file);
      return api.post('/manual-billing/proofs', formData).then((r) => r.data);
    },
    onSuccess: () => {
      toast(t('paywall.proofSubmitted'), 'success');
      queryClient.invalidateQueries({ queryKey: ['manual-billing-proofs-mine'] });
      setSelectedPlanId(null);
      setSelectedMethodId(null);
      setReference('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const redeemMutation = useMutation({
    mutationFn: () => api.post('/manual-billing/redeem', { code }).then((r) => r.data),
    onSuccess: () => {
      toast(t('paywall.redeemSuccess'), 'success');
      // Remontage complet : la garde d'accès (SubscriptionGuard) débloquera la
      // prochaine requête, on veut repartir sur l'app normale, pas rester ici.
      window.location.href = '/';
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const handleSubmitProof = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId || !selectedMethodId || !reference.trim() || !fileInputRef.current?.files?.[0]) {
      toast(t('paywall.missingFields'), 'error');
      return;
    }
    submitMutation.mutate();
  };

  const handleRedeem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    redeemMutation.mutate();
  };

  const planList = plans ?? [];
  const methodList = (methods ?? []).filter((m) => m.isActive);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('paywall.title')}</h1>
        <p className={styles.subtitle}>{t('paywall.subtitle')}</p>
      </div>

      <div className={styles.planGrid}>
        {planList.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => isAdmin && setSelectedPlanId(plan.id)}
            className={`${styles.planCard} ${selectedPlanId === plan.id ? styles.planCardSelected : ''}`}
            disabled={!isAdmin}
          >
            <div className={styles.planIcon}>{PLAN_ICONS[plan.tier] || <Package size={26} />}</div>
            <h3 className={styles.planName}>{plan.name}</h3>
            <p className={styles.planPrice}>
              {formatAriary(plan.price)}
              <span className={styles.planInterval}>/{t('paywall.perMonth')}</span>
            </p>
            <div className={styles.planFeatures}>
              {(plan.features as string[])?.map((f, i) => (
                <div key={i} className={styles.planFeatureRow}>
                  <Check size={14} className={styles.planFeatureIcon} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>

      {!isAdmin && (
        <div className={styles.contactAdminNotice}>{t('paywall.contactAdmin')}</div>
      )}

      {isAdmin && (
        <div className={styles.sectionsRow}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>{t('paywall.paymentInstructions')}</h2>
            <p className={styles.cardText}>{t('paywall.paymentInstructionsDesc')}</p>
            <div className={styles.methodList}>
              {methodList.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMethodId(m.id)}
                  className={`${styles.methodItem} ${selectedMethodId === m.id ? styles.methodItemSelected : ''}`}
                >
                  <span className={styles.methodProvider}>{PROVIDER_LABEL[m.provider] || m.provider}</span>
                  <span className={styles.methodPhone}>{m.phoneNumber}</span>
                  <span className={styles.methodHolder}>{m.holderName}</span>
                </button>
              ))}
            </div>

            {hasPendingProof ? (
              <div className={styles.pendingNotice}>
                {t('paywall.pendingReview')}
              </div>
            ) : (
              <form onSubmit={handleSubmitProof} className={styles.form}>
                <Input
                  label={t('paywall.reference')}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={t('paywall.referencePlaceholder')}
                  fullWidth
                />
                <label className={styles.fileLabel} htmlFor="proof-image">
                  <Upload size={16} />
                  {t('paywall.uploadProof')}
                </label>
                <input ref={fileInputRef} id="proof-image" type="file" accept="image/jpeg,image/png,image/webp" className={styles.fileInput} />
                <Button type="submit" variant="primary" fullWidth disabled={submitMutation.isPending}>
                  {submitMutation.isPending ? t('common.loading') : t('paywall.submitProof')}
                </Button>
              </form>
            )}

            {latestProof && latestProof.status === 'rejected' && (
              <div className={styles.rejectedNotice}>
                <Badge variant="danger" size="sm">{t('paywall.rejected')}</Badge>
                <p>{latestProof.rejectionReason}</p>
              </div>
            )}
            {latestProof && latestProof.status === 'approved' && !latestProof.rejectionReason && (
              <div className={styles.approvedNotice}>
                <Badge variant="success" size="sm">{t('paywall.approved')}</Badge>
                <p>{t('paywall.approvedDesc')}</p>
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>{t('paywall.haveCode')}</h2>
            <p className={styles.cardText}>{t('paywall.haveCodeDesc')}</p>
            <form onSubmit={handleRedeem} className={styles.form}>
              <Input
                label={t('paywall.codeLabel')}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PAY-XXXXXXXX"
                fullWidth
              />
              <Button type="submit" variant="primary" fullWidth disabled={redeemMutation.isPending}>
                {redeemMutation.isPending ? t('common.loading') : t('paywall.redeem')}
              </Button>
            </form>
          </div>
        </div>
      )}

      {latestProof && (
        <p className={styles.lastSubmitted}>
          {t('paywall.lastSubmitted', { date: formatDate(latestProof.createdAt) })}
        </p>
      )}
    </div>
  );
}
