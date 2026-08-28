import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import Button from './Button';
import styles from './CookieConsentBanner.module.css';

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
    <div className={styles.overlay} role="dialog" aria-label={t('components.cookieConsent.ariaLabel')}>
      <div className={styles.inner}>
        <p className={styles.text}>
          {/* `components` (tags nommés) et NON des enfants JSX : la traduction
              utilisait des placeholders `{privacyLink}` que i18next n'interpole
              pas (il attend `{{var}}`) — le bandeau affichait littéralement
              « Consultez notre {privacyLink} et notre {cookiesLink}. » sur la
              page d'accueil publique. */}
          <Trans
            i18nKey="components.cookieConsent.message"
            components={{
              privacyLink: <a href="/privacy" className={styles.link} />,
              cookiesLink: <a href="/cookies" className={styles.link} />,
            }}
          />
        </p>
        <div className={styles.actions}>
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
