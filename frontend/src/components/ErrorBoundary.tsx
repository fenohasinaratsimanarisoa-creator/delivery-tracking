import { Component, type ErrorInfo, type ReactNode } from 'react';
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
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.container}>
          <h1 className={styles.heading}>Erreur</h1>
          <pre className={styles.errorMessage}>
            {this.state.error.message}
          </pre>
          <pre className={styles.stackTrace}>
            {this.state.info?.componentStack || ''}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
