import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import i18n from '../services/i18n/i18n';
import { isChunkLoadError, recoverFromChunkLoadError } from '../services/pwa/chunkRecovery';
import styles from './ErrorBoundary.module.css';

interface Props { children: ReactNode; }
interface State { error: Error | null; info: ErrorInfo | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Toute page de l'app est chargée via React.lazy() (App.tsx) : un chunk
    // devenu introuvable après un redéploiement (hash changé, même pour une
    // page non modifiée — le bundle est partagé) lève une exception ICI
    // pendant le rendu, jamais via window.onerror. Sans ce branchement, le
    // bouton "Réessayer" ci-dessous relançait le même rendu → même échec
    // instantané → l'utilisateur voit l'app "bloquée" en boucle sur cet écran
    // après avoir cliqué un lien de navigation. On déclenche la même
    // récupération (reload, puis reset du service worker) que pour les
    // erreurs de chargement de script captées par main.tsx.
    if (isChunkLoadError(error.message)) {
      recoverFromChunkLoadError(`chunk introuvable (${error.message})`);
      return;
    }

    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  handleRetry = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className={styles.container}>
          <h1 className={styles.heading}>{i18n.t('components.errorBoundary.title')}</h1>
          <pre className={styles.errorMessage}>
            {this.state.error.message}
          </pre>
          <pre className={styles.stackTrace}>
            {this.state.info?.componentStack || ''}
          </pre>
          <button onClick={this.handleRetry} className={styles.retryBtn}>
            {i18n.t('components.errorBoundary.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
