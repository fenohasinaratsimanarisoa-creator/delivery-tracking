import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../../styles/ThemeContext';

export default function AppearanceSection({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();

  const options = [
    { value: 'dark' as const, label: t('settings.dark'), desc: t('settings.darkDesc'), icon: Moon },
    { value: 'light' as const, label: t('settings.light'), desc: t('settings.lightDesc'), icon: Sun },
  ];

  return (
    <div>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-xl)',
        fontWeight: 700,
        color: 'var(--color-text)',
        marginBottom: 'var(--space-xs)',
      }}>
        {t('settings.appearance')}
      </h2>
      <p style={{
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
        marginBottom: 'var(--space-xl)',
      }}>
        {t('settings.appearanceDesc')}
      </p>

      <div style={{
        display: 'flex', gap: 'var(--space-md)',
        flexWrap: 'wrap',
      }}>
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
              style={{
                flex: 1, minWidth: 200,
                padding: 'var(--space-lg)',
                borderRadius: 'var(--radius-xl)',
                background: selected ? 'var(--color-accent-muted)' : 'var(--color-surface)',
                border: selected
                  ? '2px solid var(--color-accent)'
                  : '1px solid var(--color-border-subtle)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              role="radio"
              aria-checked={selected}
            >
              <div style={{
                width: 40, height: 40,
                borderRadius: 'var(--radius-lg)',
                background: selected ? 'var(--color-accent)' : 'var(--color-surface-alt)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 'var(--space-md)',
                color: selected ? 'var(--color-bg)' : 'var(--color-text-secondary)',
              }}>
                <Icon size={20} />
              </div>
              <div style={{
                fontWeight: 600,
                fontSize: 'var(--text-base)',
                color: 'var(--color-text)',
                marginBottom: 'var(--space-xs)',
                fontFamily: 'var(--font-display)',
              }}>
                {opt.label}
              </div>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.4,
              }}>
                {opt.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
