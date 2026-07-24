import { useTranslation } from 'react-i18next';

interface Props {
  pageName?: string;
}

export default function ComingSoon({ pageName }: Props) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#666', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🚧</div>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>
        {pageName ?? t('components.comingSoon.fallbackTitle')} {t('components.comingSoon.title')}
      </h2>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>
        {t('components.comingSoon.description')}
      </p>
    </div>
  );
}
