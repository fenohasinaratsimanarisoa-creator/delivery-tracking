import * as Sentry from '@sentry/node';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] SENTRY_DSN not set — skipping initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 0.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
    denyUrls: [],
    beforeSend(event) {
      if (event.request?.data) {
        const sanitized: Record<string, unknown> = {
          ...(event.request.data as Record<string, unknown>),
        };
        ['password', 'token', 'accessToken', 'refreshToken', 'secret', 'authorization'].forEach(
          (k) => {
            if (k in sanitized) sanitized[k] = '[REDACTED]';
          },
        );
        event.request.data = sanitized;
      }
      return event;
    },
  });
}
