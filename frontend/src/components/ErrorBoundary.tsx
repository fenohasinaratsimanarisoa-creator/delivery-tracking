import { Component, type ErrorInfo, type ReactNode } from 'react';

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
        <div style={{
          padding: 40, fontFamily: 'monospace', background: '#0B1220',
          color: '#E8ECF3', minHeight: '100vh',
        }}>
          <h1 style={{ color: 'var(--color-red, #E8544C)', marginBottom: 16 }}>Erreur</h1>
          <pre style={{
            whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5,
            color: 'var(--color-red, #E8544C)', marginBottom: 20,
          }}>
            {this.state.error.message}
          </pre>
          <pre style={{
            whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.4,
            color: 'var(--color-text-secondary, #9BA6B9)', opacity: 0.8,
          }}>
            {this.state.info?.componentStack || ''}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
