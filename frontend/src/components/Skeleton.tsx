import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface Props {
  /** Forme du bloc. `text` = ligne de texte, `block` = surface, `circle` = pastille/avatar. */
  variant?: 'text' | 'block' | 'circle';
  width?: number | string;
  height?: number | string;
  /** Nombre de lignes (variant `text` uniquement). */
  lines?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Bloc de chargement. À composer pour reproduire la FORME réelle du contenu
 * (ligne de table, carte, en-tête…) plutôt qu'afficher un spinner générique.
 * Animation `dt-shimmer` (définie une fois dans globalStyles), coupée par
 * prefers-reduced-motion.
 */
export default function Skeleton({ variant = 'text', width, height, lines = 1, className, style }: Props) {
  const base = [styles.root, styles[variant], className].filter(Boolean).join(' ');

  if (variant === 'text' && lines > 1) {
    return (
      <span className={styles.stack} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={base}
            style={{
              width: i === lines - 1 ? '70%' : (width ?? '100%'),
              height,
              ...style,
            }}
          />
        ))}
      </span>
    );
  }

  return <span className={base} aria-hidden="true" style={{ width, height, ...style }} />;
}
