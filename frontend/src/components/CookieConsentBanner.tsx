import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import Button from './Button';

const CONSENT_KEY = 'cookie_consent';

type ConsentChoice = 'accepted' | 'refused' | null;

function getStoredConsent(): ConsentChoice {
  const v = localStorage.getItem(CONSENT_KEY);
  if (v === 'accepted' || v === 'refused') return v;
  return null;
}

function storeConsent(choice: ConsentChoice) {
  if (choice) {
    localStorage.setItem(CONSENT_KEY, choice);
  } else {
    localStorage.removeItem(CONSENT_KEY);
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
    background: 'var(--color-surface)',
    borderTop: '1px solid var(--color-border)',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
    padding: 'var(--space-lg) var(--space-xl)',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-sm)',
  },
  inner: {
    maxWidth: 960, margin: '0 auto',
    display: 'flex', alignItems: 'center', gap: 'var(--space-lg)',
    flexWrap: 'wrap' as const,
  },
  text: {
    flex: 1, minWidth: 280, color: 'var(--color-text-secondary)',
    lineHeight: 1.5, margin: 0,
  },
  link: {
    color: 'var(--color-accent)', textDecoration: 'underline',
    cursor: 'pointer',
  },
  actions: {
    display: 'flex', gap: 'var(--space-sm)', flexShrink: 0,
    alignItems: 'center',
  },
};

export default function CookieConsentBanner() {
  const { t } = useTranslation();
  const [consent, setConsent] = useState<ConsentChoice>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(getStoredConsent());
    setReady(true);
  }, []);

  const accept = () => {
    storeConsent('accepted');
    setConsent('accepted');
  };

  const refuse = () => {
    storeConsent('refused');
    setConsent('refused');
  };

  if (!ready || consent !== null) return null;

  return (
    <div style={styles.overlay} role="dialog" aria-label={t('components.cookieConsent.ariaLabel')}>
      <div style={styles.inner}>
        <p style={styles.text}>
          <Trans i18nKey="components.cookieConsent.message">
            Nous utilisons des cookies essentiels au fonctionnement du service et, sous réserve
            de votre consentement, des cookies d&rsquo;analyse pour améliorer notre plateforme.
            Consultez notre{' '}
            <a href="/privacy" style={styles.link}>politique de confidentialité</a>{' '}
            et notre{' '}
            <a href="/cookies" style={styles.link}>politique de cookies</a>.
          </Trans>
        </p>
        <div style={styles.actions}>
          <Button variant="ghost" size="sm" onClick={refuse}>
            {t('components.cookieConsent.refuse')}
          </Button>
          <Button variant="primary" size="sm" onClick={accept}>
            {t('components.cookieConsent.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
