import { type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  visualPanel: ReactNode;
}

const bgGradient = 'radial-gradient(ellipse at 20% 50%, rgba(242,169,60,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 10%, rgba(59,130,246,0.04) 0%, transparent 50%), var(--color-bg, #0B1220)';

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    width: '100%',
    background: bgGradient,
  },
  formPanel: {
    flex: '1 1 50%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    position: 'relative',
  },
  glassCard: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--color-glass)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--color-glass-border)',
    borderRadius: 'var(--radius-2xl)',
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 36px',
    position: 'relative',
    zIndex: 1,
  },
  visualPanel: {
    flex: '1 1 50%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    contentVisibility: 'auto',
  },
};

export default function LoginLayout({ children, visualPanel }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.formPanel}>
        <div style={styles.glassCard}>
          {children}
        </div>
      </div>
      <div style={styles.visualPanel}>
        {visualPanel}
      </div>
    </div>
  );
}
