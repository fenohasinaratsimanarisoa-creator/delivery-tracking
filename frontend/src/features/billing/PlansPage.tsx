import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, FileText, CreditCard, Smartphone, Truck, Zap, Building2, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../services/i18n/formatDate';
import { isNativeApp } from '../../services/native/nativeAuth';
import api from '../../services/api/client';
import { useToast } from '../../components/Toast';
import EntityDialog, { DialogSubmitBar } from '../../components/EntityDialog';
import type { BillingPlan, Subscription } from '../../types';
import styles from './PlansPage.module.css';

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Package size={26} />,
  starter: <Truck size={26} />,
  pro: <Zap size={26} />,
  enterprise: <Building2 size={26} />,
};

const getPlanHighlight = (tier: string) => {
  if (tier === 'free') return '#6b7280';
  if (tier === 'starter') return 'var(--color-teal)';
  if (tier === 'pro') return 'var(--color-accent)';
  return 'var(--color-text)';
};

async function openPaymentUrl(url: string): Promise<void> {
  // URL externe (checkout Stripe, futur paiement Mobile Money web) :
  // dans l'app native on ouvre un custom tab via @capacitor/browser au lieu de
  // naviguer la WebView hors du domaine de l'app (server.allowNavigation).
  if (isNativeApp() && !url.startsWith(window.location.origin)) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return;
  }
  window.location.href = url;
}

export default function PlansPage() {
  const { t } = useTranslation();
  const [upgradeDialog, setUpgradeDialog] = useState<{ plan: BillingPlan; provider: string; phone: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: plans, isLoading } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.get('/billing/plans').then((r) => r.data),
  });

  const { data: subscription } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api.get('/billing/subscription').then((r) => r.data),
  });

  const upgradeMutation = useMutation({
    mutationFn: (body: { planId: string; provider: string; mobileMoneyPhone?: string }) =>
      api.post('/billing/subscription', body).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      setUpgradeDialog(null);
      if (data?.provider === 'mvola' || data?.provider === 'orange_money') {
        toast(t('billing.plans.toast.paymentSent', { reference: data.transactionRef || '' }), 'success');
      }
      if (data?.sessionUrl) {
        void (async () => {
          await openPaymentUrl(data.sessionUrl);
          queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
        })();
        return;
      }
      toast(t('billing.plans.toast.subscriptionUpdated'), 'success');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('billing.plans.toast.subscriptionError'), 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post('/billing/subscription/cancel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      toast(t('billing.plans.toast.subscriptionCanceled'));
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const planList: BillingPlan[] = plans ?? [];
  const currentSub: Subscription | null = subscription ?? null;

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>
            {t('billing.plans.title')}
          </h1>
          <p className={styles.subtitle}>
            {t('billing.plans.subtitle')}
          </p>
        </div>
        <Link to="/billing/invoices" className={styles.invoicesLink}>
          <FileText size={14} />
          {t('billing.plans.invoices')}
        </Link>
      </div>

      {currentSub && (
        <div className={styles.currentSubCard}>
          <div className={styles.currentSubInner}>
            <div>
              <p className={styles.currentSubLabel}>
                {t('billing.plans.currentPlan')}
              </p>
              <p className={styles.currentSubName}>
                {currentSub.plan?.name || t('billing.plans.free')}
              </p>
              <p className={styles.currentSubInfo}>
                {currentSub.status === 'active' ? t('billing.plans.active') :
                 currentSub.status === 'past_due' ? t('billing.plans.pastDue') :
                 currentSub.status === 'canceled' ? t('billing.plans.canceled') :
                 currentSub.status === 'unpaid' ? t('billing.plans.unpaid') : currentSub.status}
                {currentSub.currentPeriodEnd && ` — ${t('billing.plans.nextBilling', { date: formatDate(currentSub.currentPeriodEnd) })}`}
              </p>
            </div>
            {currentSub.status !== 'canceled' && currentSub.status !== 'unpaid' && (
              <button
                onClick={() => cancelMutation.mutate()}
                className={styles.cancelBtn}
              >
                {t('billing.plans.cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.loadingContainer}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      ) : (
        <div className={styles.planGrid}>
          {planList.map((plan) => {
            const isCurrent = currentSub?.planId === plan.id;
            const priceDisplay = plan.price === 0 ? t('billing.plans.free') : `${(plan.price / 100).toFixed(2)} ${plan.currency}${plan.interval === 'year' ? t('billing.plans.perYear') : t('billing.plans.perMonth')}`;

            return (
              <div key={plan.id} className={`${styles.planCard} ${isCurrent ? styles.planCardCurrent : ''}`}>
                {isCurrent && (
                  <div className={styles.currentBadge}>
                    {t('billing.plans.current')}
                  </div>
                )}
                <div className={styles.planIcon} style={{ color: getPlanHighlight(plan.tier) }}>
                  {PLAN_ICONS[plan.tier] || <Package size={26} />}
                </div>
                <h3 className={styles.planName}>
                  {plan.name}
                </h3>
                <p className={styles.planPrice} style={{ color: getPlanHighlight(plan.tier) }}>
                  {priceDisplay}
                </p>
                {plan.description && (
                  <p className={styles.planDesc}>
                    {plan.description}
                  </p>
                )}
                <div className={styles.planFeatures}>
                  <div className={styles.planFeatureItem}>
                    <p className={styles.planFeatureLabel}>
                      {t('billing.plans.features.maxVehicles', { maxVehicles: plan.maxVehicles })}
                    </p>
                  </div>
                  <div className={styles.planFeatureItem}>
                    <p className={styles.planFeatureLabel}>
                      {t('billing.plans.features.maxDeliveries', { maxDeliveriesPerMonth: plan.maxDeliveriesPerMonth })}
                    </p>
                  </div>
                  <div className={styles.planFeatureItem}>
                    <p className={styles.planFeatureLabel}>
                      {t('billing.plans.features.maxUsers', { maxUsers: plan.maxUsers })}
                    </p>
                  </div>
                  {(plan.features as string[])?.map((f, i) => (
                    <div key={i} className={styles.planFeatureRow}>
                      <Check size={14} className={styles.planFeatureIcon} />
                      <span className={styles.planFeatureText}>{f}</span>
                    </div>
                  ))}
                </div>
                {!isCurrent && plan.price > 0 && (
                  <button
                    onClick={() => setUpgradeDialog({ plan, provider: 'stripe', phone: '' })}
                    className={styles.subscribeBtn}
                  >
                    {plan.tier === 'starter' ? t('billing.plans.chooseStarter') :
                     plan.tier === 'pro' ? t('billing.plans.upgradePro') :
                     plan.tier === 'enterprise' ? t('billing.plans.contact') : t('billing.plans.subscribe')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <EntityDialog
        open={!!upgradeDialog}
        onClose={() => setUpgradeDialog(null)}
        title={t('billing.plans.paymentDialogTitle')}
        subtitle={upgradeDialog ? t('billing.plans.paymentDialogSubtitle', { planName: upgradeDialog.plan.name }) : ''}
        footer={
          <DialogSubmitBar
            loading={upgradeMutation.isPending}
            onCancel={() => setUpgradeDialog(null)}
            submitLabel={t('billing.plans.confirm')}
            error={null}
          />
        }
      >
        <div className={styles.paymentMethodList}>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'stripe' });
            }}
            className={styles.paymentMethodBtn}
          >
            <span className={styles.paymentMethodIcon} style={{ color: 'var(--color-accent)' }}>
              <CreditCard size={20} />
            </span>
            <div>
              <p className={styles.paymentMethodTitle}>
                {t('billing.plans.creditCard')}
              </p>
              <p className={styles.paymentMethodDesc}>
                {t('billing.plans.creditCardDesc')}
              </p>
            </div>
          </button>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'mvola', mobileMoneyPhone: upgradeDialog.phone || undefined });
            }}
            className={styles.paymentMethodBtn}
          >
            <span className={styles.paymentMethodIcon} style={{ color: 'var(--color-teal)' }}>
              <Smartphone size={20} />
            </span>
            <div>
              <p className={styles.paymentMethodTitle}>
                {t('billing.plans.mvola')}
              </p>
              <p className={styles.paymentMethodDesc}>
                {t('billing.plans.mvolaDesc')}
              </p>
            </div>
          </button>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'orange_money', mobileMoneyPhone: upgradeDialog.phone || undefined });
            }}
            className={styles.paymentMethodBtn}
          >
            <span className={styles.paymentMethodIcon} style={{ color: 'var(--color-warning)' }}>
              <Smartphone size={20} />
            </span>
            <div>
              <p className={styles.paymentMethodTitle}>
                {t('billing.plans.orangeMoney')}
              </p>
              <p className={styles.paymentMethodDesc}>
                {t('billing.plans.orangeMoneyDesc')}
              </p>
            </div>
          </button>
        </div>
      </EntityDialog>
    </div>
  );
}
