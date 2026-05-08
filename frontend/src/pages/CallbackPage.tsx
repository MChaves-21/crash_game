import { useEffect, useState } from 'react';
import { useNavigate }        from 'react-router-dom';
import { authApi, walletApi } from '../services/api';

export function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const state  = params.get('state');

    if (!code || !state) {
      setError('Parâmetros OAuth inválidos');
      return;
    }

    authApi.handleCallback(code, state)
      .then(async (token) => {
        // Tenta criar carteira (ignora 409 se já existe)
        try { await walletApi.createWallet(); } catch {}
        navigate('/game', { replace: true });
      })
      .catch(err => setError(err.message));
  }, []);

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-void)' }}>
      <div style={{ textAlign: 'center', color: 'var(--neon-red)', fontFamily: 'var(--font-mono)' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 12 }}>⚠ Erro no login</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{error}</div>
        <button onClick={() => navigate('/')}
          style={{ marginTop: 20, padding: '8px 20px', background: 'var(--bg-card)',
                   border: '1px solid var(--border)', borderRadius: 6,
                   color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
          Voltar
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-void)', flexDirection: 'column', gap: 16 }}>
      {/* Spinner */}
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: '3px solid var(--border)',
        borderTopColor: 'var(--neon-green)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                    color: 'var(--text-secondary)', letterSpacing: '0.08em' }}>
        Autenticando...
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
