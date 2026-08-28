import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const sizeClassMap: Record<string, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

const variantClassMap: Record<string, string> = {
  primary: styles.variantPrimary,
  secondary: styles.variantSecondary,
  success: styles.variantSuccess,
  danger: styles.variantDanger,
  ghost: styles.variantGhost,
  outline: styles.variantOutline,
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  fullWidth,
  children,
  className,
  // Défaut explicite `button` : un <Button> sans type dans un <form> soumettait
  // le formulaire au clic/Entrée (bug latent). Les vrais boutons d'envoi
  // portent déjà `type="submit"` explicitement (vérifié sur tous les forms).
  type = 'button',
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        styles.root,
        sizeClassMap[size] ?? '',
        variantClassMap[variant] ?? '',
        fullWidth ? styles.fullWidth : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <span className={`${styles.loading}${size === 'sm' ? ` ${styles.loadingSm}` : ''}`} aria-hidden="true" />
      ) : icon ? (
        <span className={styles.iconWrap} aria-hidden="true">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
