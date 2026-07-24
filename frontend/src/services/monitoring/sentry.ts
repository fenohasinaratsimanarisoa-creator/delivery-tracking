import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN not set — skipping initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_APP_ENV || 'development',
    tracesSampleRate: import.meta.env.VITE_APP_ENV === 'production' ? 0.2 : 0.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.request?.data) {
        const sanitized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(event.request.data)) {
          if (['password', 'token', 'accessToken', 'refreshToken', 'secret', 'authorization', 'creditCard', 'cvv'].includes(k)) {
            sanitized[k] = '[REDACTED]';
          } else {
            sanitized[k] = v;
          }
        }
        event.request.data = sanitized;
      }
      return event;
    },
  });
}

export function setSentryUser(user: { id: string; email?: string; companyId?: string; role?: string } | null) {
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    email: user.email ? undefined : undefined,
    ip_address: undefined,
  });
  Sentry.setTag('companyId', user.companyId || 'anonymous');
  Sentry.setTag('role', user.role || 'anonymous');
}
