import { useId, useState, type ReactElement, cloneElement } from 'react';
import styles from './Tooltip.module.css';

interface Props {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** L'élément déclencheur : reçoit aria-describedby + les handlers de survol/focus. */
  children: ReactElement;
}

/**
 * Tooltip CSS-only (pas de portal ni de positionnement JS) : suffisant pour des
 * libellés courts sur des boutons-icônes. S'affiche au survol ET au focus
 * clavier, se masque sur Échap. `content` est aussi exposé en aria-describedby.
 */
export default function Tooltip({ content, side = 'top', children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      setOpen(true);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      setOpen(false);
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      setOpen(false);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      children.props.onKeyDown?.(e);
      if (e.key === 'Escape') setOpen(false);
    },
  });

  return (
    <span className={styles.wrap}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={`${styles.bubble} ${styles[side]}${open ? ` ${styles.open}` : ''}`}
      >
        {content}
      </span>
    </span>
  );
}
