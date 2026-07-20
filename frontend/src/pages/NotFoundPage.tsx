import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#666', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: '4rem', fontWeight: 700, color: '#dc3545', marginBottom: 8 }}>404</div>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>Page introuvable</h2>
      <p style={{ margin: '0 0 24px', fontSize: '0.9rem' }}>
        La page que vous cherchez n'existe pas.
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
