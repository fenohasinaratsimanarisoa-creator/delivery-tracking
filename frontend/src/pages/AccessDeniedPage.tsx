import { useNavigate } from 'react-router-dom';

export default function AccessDeniedPage() {
  const navigate = useNavigate();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#666', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 8 }}>🚫</div>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>Accès refusé</h2>
      <p style={{ margin: '0 0 24px', fontSize: '0.9rem' }}>
        Vous n'avez pas les droits nécessaires pour accéder à cette page.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          padding: '10px 24px', background: '#007bff', color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
        }}
      >
        Retour au Dashboard
      </button>
    </div>
  );
}
