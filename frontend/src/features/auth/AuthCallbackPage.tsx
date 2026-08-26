import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import { parseToken } from '../../services/jwt';
import { getApiBaseUrl } from '../../services/api/config';
import { isNativeApp, isWebView, isMobileBrowser, relayTokenToNativeApp, buildRelayDeepLink, OAUTH_VERIFIER_KEY, clearOAuthNativeState } from '../../services/native/nativeAuth';
import type { User } from '../../types';
import { Loader2, AlertCircle } from 'lucide-react';
import styles from './AuthCallbackPage.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'auth.callback.googleRefused',
  email_not_verified: 'auth.callback.emailNotVerified',
  account_not_found: 'auth.callback.accountNotFound',
  account_deactivated: 'auth.callback.accountDeactivated',
  google_auth_failed: 'auth.callback.googleAuthFailed',
};

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isInitializing, isAuthenticated, user, login } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'relay'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [relayLink, setRelayLink] = useState('');
  const processedRef = useRef(false);
  const loginRef = useRef(login);
  loginRef.current = login;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const applyLogin = (token: string, payload: ReturnType<typeof parseToken> & object) => {
    processedRef.current = true;
    const u: User = {
      id: (payload.sub || payload.id) as string,
      email: payload.email as string,
      role: payload.role as User['role'],
      companyId: payload.companyId as string,
      firstName: (payload.firstName || payload.given_name || '') as string,
      lastName: (payload.lastName || payload.family_name || '') as string,
    };
    setAccessToken(token);
    clearOAuthNativeState();
    loginRef.current(u, token);
    setStatus('success');
    navigateRef.current('/', { replace: true });
  };

  // Échange le code à usage unique contre une session (PKCE + single-use).
  // Le JWT d'accès n'est présent que dans la réponse, jamais dans une URL.
  const exchangeCode = useCallback(
    async (code: string) => {
      processedRef.current = true;
      try {
        const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);
        if (!verifier) {
          throw new Error('missing PKCE verifier');
        }
        const res = await fetch(`${getApiBaseUrl()}/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, verifier }),
        });
        if (!res.ok) {
          throw new Error(`exchange failed: ${res.status}`);
        }
        const data = (await res.json()) as { accessToken?: string };
        const payload = data.accessToken ? parseToken(data.accessToken) : null;
        if (!data.accessToken || !payload) {
          throw new Error('invalid exchange response');
        }
        applyLogin(data.accessToken, payload);
      } catch (err) {
        console.warn('[auth] code exchange rejected:', err);
        setStatus('error');
        setErrorMessage(t('auth.callback.finalizeError'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  useEffect(() => {
    if (processedRef.current) return;

    const error = searchParams.get('error');
    if (error) {
      processedRef.current = true;
      setStatus('error');
      setErrorMessage(t(ERROR_MESSAGES[error] || t(ERROR_MESSAGES.google_auth_failed)));
      return;
    }

    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    const tokenFromHash = hashParams.get('accessToken');

    // Nouveau flux natif sécurisé : code d'échange + state (nonce).
    const codeFromHash = hashParams.get('code');
    const stateFromHash = hashParams.get('state');

    if (codeFromHash && stateFromHash) {
      if (!isNativeApp() && !isWebView() && isMobileBrowser()) {
        // Custom tab : on relaie code + state vers l'app native via le custom
        // scheme. L'app vérifie le state dans appUrlOpen, puis échange le code
        // dans le WebView (elle seule détient le verifier PKCE).
        //
        // BUG CORRIGÉ (audit 2026-08-26) : la redirection JS automatique
        // (window.location.replace vers logitrack://...) peut être silencieusement
        // ignorée par Chrome (politique de navigation vers un schéma personnalisé
        // sans geste utilisateur direct) ou bloquée par des restrictions
        // constructeur (MIUI, notamment, limite l'ouverture d'apps en arrière-plan
        // depuis une autre application) — observé en usage réel : la connexion
        // Google réussissait côté serveur, mais le code n'atteignait JAMAIS
        // l'app (aucun appel à /auth/exchange), laissant l'utilisateur "connecté"
        // dans l'onglet du navigateur système tandis que l'app elle-même restait
        // déconnectée en permanence. On tente la redirection automatique, ET on
        // affiche IMMÉDIATEMENT un lien manuel cliquable identique (un vrai <a>,
        // donc un geste utilisateur garanti) en secours si elle échoue.
        relayTokenToNativeApp(codeFromHash, stateFromHash);
        setRelayLink(buildRelayDeepLink(codeFromHash, stateFromHash));
        setStatus('relay');
        return;
      }
      // WebView native : échange immédiat du code contre une session.
      void exchangeCode(codeFromHash);
      return;
    }

    if (tokenFromHash) {
      const payload = parseToken(tokenFromHash);
      if (payload) {
        // Flux web : le JWT ne transite plus par le custom scheme. Le flux natif
        // sécurisé passe exclusivement par code+state (#code&state), relayés par
        // relayTokenToNativeApp dans la branche au-dessus.
        applyLogin(tokenFromHash, payload);
        return;
      }
    }

    if (isInitializing) return;

    if (isAuthenticated && user) {
      processedRef.current = true;
      setStatus('success');
      navigateRef.current('/', { replace: true });
      return;
    }

    if (!isInitializing && !isAuthenticated) {
      processedRef.current = true;
      setStatus('error');
      setErrorMessage(t('auth.callback.finalizeError'));
    }
  }, [isInitializing, isAuthenticated, user, searchParams, t]);

  return (
    <div className={styles.container}>
      {status === 'loading' && (
        <>
          <Loader2 size={32} className={styles.loadingIcon} />
          <div className={styles.loadingText}>{t('auth.callback.connecting')}</div>
        </>
      )}

      {status === 'relay' && (
        <>
          <div className={styles.loadingText}>{t('auth.callback.connecting')}</div>
          {relayLink && (
            <a href={relayLink} className={styles.backLink}>
              {t('auth.callback.openApp', "L'application ne s'est pas ouverte ? Appuyez ici")}
            </a>
          )}
        </>
      )}

      {status === 'success' && (
        <>
          <div className={styles.successText}>{t('auth.callback.loginSuccess')}</div>
        </>
      )}

      {status === 'error' && (
        <div className={styles.errorCard}>
          <div className={styles.errorIconCircle}>
            <AlertCircle size={24} className={styles.errorIcon} />
          </div>
          <p className={styles.errorMessage}>
            {errorMessage}
          </p>
          <Link
            to="/login"
            className={styles.backLink}
          >
            {t('auth.callback.backToLogin')}
          </Link>
        </div>
      )}
    </div>
  );
}
