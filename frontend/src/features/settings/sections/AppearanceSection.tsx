import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../../styles/ThemeContext';
import styles from './AppearanceSection.module.css';

export default function AppearanceSection({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();

  const options = [
    { value: 'dark' as const, label: t('settings.dark'), desc: t('settings.darkDesc'), icon: Moon },
    { value: 'light' as const, label: t('settings.light'), desc: t('settings.lightDesc'), icon: Sun },
  ];

  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>
        {t('settings.appearance')}
      </h2>
      <p className={styles.description}>
        {t('settings.appearanceDesc')}
      </p>

      <div className={styles.optionsRow}>
        {options.map((opt) => {
          const selected = mode === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => {
                setMode(opt.value);
                onDirtyChange?.(false);
              }}
              className={styles.optionButton}
              style={{
                background: selected ? 'var(--color-accent-muted)' : 'var(--color-surface)',
                border: selected
                  ? '2px solid var(--color-accent)'
                  : '1px solid var(--color-border-subtle)',
              }}
              role="radio"
              aria-checked={selected}
            >
              <div
                className={styles.iconBox}
                style={{
                  background: selected ? 'var(--color-accent)' : 'var(--color-surface-alt)',
                  color: selected ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                }}
              >
                <Icon size={20} />
              </div>
              <div className={styles.optionLabel}>
                {opt.label}
              </div>
              <div className={styles.optionDesc}>
                {opt.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
