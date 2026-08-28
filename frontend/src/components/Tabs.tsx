import { useId, useRef, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface Props {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Barre d'onglets accessible (role=tablist) : navigation clavier ←/→/Home/End,
 * roving tabindex. Le contenu de chaque panneau est géré par l'appelant (il
 * suffit de brancher sur `value`).
 */
export default function Tabs({ items, value, onChange, className, 'aria-label': ariaLabel }: Props) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusIndex = (i: number) => {
    const enabled = items.map((it, idx) => ({ it, idx })).filter(({ it }) => !it.disabled);
    if (enabled.length === 0) return;
    const wrapped = ((i % enabled.length) + enabled.length) % enabled.length;
    const target = enabled[wrapped].idx;
    refs.current[target]?.focus();
    onChange(items[target].value);
  };

  const currentEnabledPos = () => {
    const enabled = items.filter((it) => !it.disabled);
    return enabled.findIndex((it) => it.value === value);
  };

  return (
    <div
      className={[styles.list, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(n) => (refs.current[i] = n)}
            type="button"
            role="tab"
            id={`${baseId}-tab-${item.value}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={`${styles.tab}${selected ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                focusIndex(currentEnabledPos() + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                focusIndex(currentEnabledPos() - 1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                focusIndex(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                focusIndex(-1);
              }
            }}
          >
            {item.icon && <span className={styles.icon} aria-hidden="true">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
