interface Props {
  pageName?: string;
}

export default function ComingSoon({ pageName }: Props) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#666', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🚧</div>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>
        {pageName ?? 'Fonctionnalité'} à venir
      </h2>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>
        Cette page sera disponible prochainement.
      </p>
    </div>
  );
}
