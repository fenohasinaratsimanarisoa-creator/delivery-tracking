import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../services/i18n/formatDate';
import api from '../../services/api/client';
import { useToast } from '../../components/Toast';
import EntityDialog, { DialogSubmitBar } from '../../components/EntityDialog';
import type { BillingPlan, Subscription } from '../../types';

const PLAN_ICONS: Record<string, string> = {
  free: '🟢',
  starter: '🔵',
  pro: '🟣',
  enterprise: '⚫',
};

const getPlanHighlight = (tier: string) => {
  if (tier === 'free') return '#6b7280';
  if (tier === 'starter') return 'var(--color-teal)';
  if (tier === 'pro') return 'var(--color-accent)';
  return 'var(--color-text)';
};

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
        window.location.href = data.sessionUrl;
        return;
      }
      toast(t('billing.plans.toast.subscriptionUpdated'), 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || t('billing.plans.toast.subscriptionError'), 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post('/billing/subscription/cancel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      toast(t('billing.plans.toast.subscriptionCanceled'));
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const planList: BillingPlan[] = plans ?? [];
  const currentSub: Subscription | null = subscription ?? null;

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700,
            color: 'var(--color-text)', letterSpacing: '-0.02em', margin: 0,
          }}>
            {t('billing.plans.title')}
          </h1>
          <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {t('billing.plans.subtitle')}
          </p>
        </div>
        <Link to="/billing/invoices" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-xs)',
          padding: 'var(--space-sm) var(--space-lg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          textDecoration: 'none',
          fontSize: 'var(--text-sm)', fontWeight: 500,
          fontFamily: 'var(--font-body)',
          cursor: 'pointer',
        }}>
          <FileText size={14} />
          {t('billing.plans.invoices')}
        </Link>
      </div>

      {currentSub && (
        <div style={{
          marginBottom: 'var(--space-xl)',
          padding: 'var(--space-lg) var(--space-xl)',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('billing.plans.currentPlan')}
              </p>
              <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)' }}>
                {currentSub.plan?.name || t('billing.plans.free')}
              </p>
              <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
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
                style={{
                  padding: 'var(--space-sm) var(--space-lg)',
                  border: '1px solid var(--color-red)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--color-red)',
                  cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500,
                  fontFamily: 'var(--font-body)',
                }}
              >
                {t('billing.plans.cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4xl)' }}>
          <Loader2 size={24} style={{ animation: 'dt-spin 0.6s linear infinite' }} />
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-lg)',
        }}>
          {planList.map((plan) => {
            const isCurrent = currentSub?.planId === plan.id;
            const priceDisplay = plan.price === 0 ? t('billing.plans.free') : `${(plan.price / 100).toFixed(2)} ${plan.currency}${plan.interval === 'year' ? t('billing.plans.perYear') : t('billing.plans.perMonth')}`;

            return (
              <div key={plan.id} style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${isCurrent ? 'var(--color-accent)' : 'var(--color-border)'}`,
                padding: 'var(--space-xl)',
                display: 'flex', flexDirection: 'column',
                position: 'relative',
                transition: 'border-color 0.15s',
              }}>
                {isCurrent && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    padding: '2px 12px',
                    background: 'var(--color-accent)',
                    color: 'var(--color-bg)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {t('billing.plans.current')}
                  </div>
                )}
                <div style={{ fontSize: 32, marginBottom: 'var(--space-sm)' }}>
                  {PLAN_ICONS[plan.tier] || '📦'}
                </div>
                <h3 style={{
                  fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)',
                  fontWeight: 700, color: 'var(--color-text)', margin: 0,
                }}>
                  {plan.name}
                </h3>
                <p style={{
                  margin: 'var(--space-xs) 0 var(--space-md)',
                  fontSize: 'var(--text-2xl)', fontWeight: 700,
                  color: getPlanHighlight(plan.tier),
                  fontFamily: 'var(--font-display)',
                }}>
                  {priceDisplay}
                </p>
                {plan.description && (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' }}>
                    {plan.description}
                  </p>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 'var(--space-sm)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                      {t('billing.plans.features.maxVehicles', { maxVehicles: plan.maxVehicles })}
                    </p>
                  </div>
                  <div style={{ marginBottom: 'var(--space-sm)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                      {t('billing.plans.features.maxDeliveries', { maxDeliveriesPerMonth: plan.maxDeliveriesPerMonth })}
                    </p>
                  </div>
                  <div style={{ marginBottom: 'var(--space-lg)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                      {t('billing.plans.features.maxUsers', { maxUsers: plan.maxUsers })}
                    </p>
                  </div>
                  {(plan.features as string[])?.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                      marginBottom: 'var(--space-xs)',
                    }}>
                      <Check size={14} style={{ color: 'var(--color-teal)', flexShrink: 0 }} />
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{f}</span>
                    </div>
                  ))}
                </div>
                {!isCurrent && plan.price > 0 && (
                  <button
                    onClick={() => setUpgradeDialog({ plan, provider: 'stripe', phone: '' })}
                    style={{
                      marginTop: 'var(--space-lg)',
                      padding: 'var(--space-sm) var(--space-lg)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-accent)',
                      color: 'var(--color-bg)',
                      cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
                      fontFamily: 'var(--font-body)',
                    }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'stripe' });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
              padding: 'var(--space-lg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 24 }}>💳</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>
                {t('billing.plans.creditCard')}
              </p>
              <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {t('billing.plans.creditCardDesc')}
              </p>
            </div>
          </button>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'mvola', mobileMoneyPhone: upgradeDialog.phone || undefined });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
              padding: 'var(--space-lg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 24 }}>📱</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>
                {t('billing.plans.mvola')}
              </p>
              <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {t('billing.plans.mvolaDesc')}
              </p>
            </div>
          </button>
          <button
            onClick={() => {
              if (!upgradeDialog) return;
              upgradeMutation.mutate({ planId: upgradeDialog.plan.id, provider: 'orange_money', mobileMoneyPhone: upgradeDialog.phone || undefined });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
              padding: 'var(--space-lg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 24 }}>📱</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>
                {t('billing.plans.orangeMoney')}
              </p>
              <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {t('billing.plans.orangeMoneyDesc')}
              </p>
            </div>
          </button>
        </div>
      </EntityDialog>
    </div>
  );
}
