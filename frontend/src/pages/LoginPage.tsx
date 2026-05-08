import { authApi } from '../services/api';

export function LoginPage() {
  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'var(--bg-void)',
      position:       'relative',
      overflow:       'hidden',
    }}>

      {/* Fundo decorativo */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 80% 60% at 20% 80%, rgba(0,255,136,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 20%, rgba(0,170,255,0.04) 0%, transparent 60%)
        `,
      }} />

      {/* Grid lines decorativas */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      {/* Card central */}
      <div style={{
        position:   'relative',
        width:      '100%',
        maxWidth:   400,
        padding:    '48px 40px',
        background: 'var(--bg-panel)',
        border:     '1px solid var(--border)',
        borderRadius: 16,
        textAlign:  'center',
        boxShadow:  '0 40px 80px rgba(0,0,0,0.6)',
      }}>

        {/* Logo */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            fontFamily:    'var(--font-display)',
            fontWeight:    900,
            fontSize:      '3.5rem',
            color:         'var(--neon-green)',
            textShadow:    'var(--glow-green)',
            lineHeight:    1,
            letterSpacing: '-0.02em',
          }}>
            🦧 JUNGLE
          </div>
          <div style={{
            fontFamily:    'var(--font-display)',
            fontWeight:    300,
            fontSize:      '1.5rem',
            color:         'var(--text-secondary)',
            letterSpacing: '0.3em',
            marginTop:     4,
          }}>
            CRASH GAME
          </div>
        </div>

        {/* Separador */}
        <div style={{
          height:     1,
          background: 'linear-gradient(90deg, transparent, var(--border-bright), transparent)',
          marginBottom: 32,
        }} />

        {/* Descrição */}
        <p style={{
          fontFamily: 'var(--font-ui)',
          fontSize:   '0.85rem',
          color:      'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: 32,
        }}>
          Multiplayer crash game em tempo real.<br />
          Aposte, acompanhe o multiplicador subir<br />
          e saque antes do crash.
        </p>

        {/* Stats decorativas */}
        <div style={{
          display:      'grid',
          gridTemplate: '1fr / 1fr 1fr 1fr',
          gap:          12,
          marginBottom: 36,
        }}>
          {[
            { label: 'Mín. aposta', value: 'R$ 1' },
            { label: 'Máx. aposta', value: 'R$ 1K' },
            { label: 'Tempo real', value: 'WS' },
          ].map(s => (
            <div key={s.label} style={{
              background:   'var(--bg-dark)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              padding:      '10px 8px',
            }}>
              <div style={{
                fontFamily:    'var(--font-mono)',
                fontWeight:    700,
                fontSize:      '0.9rem',
                color:         'var(--neon-green)',
                marginBottom:  2,
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize:   '0.6rem',
                color:      'var(--text-dim)',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Botão de login */}
        <button
          onClick={authApi.login}
          className="btn-bet"
          style={{ width: '100%', fontSize: '1rem', padding: '16px' }}
        >
          Entrar com Keycloak
        </button>

        <p style={{
          marginTop:  16,
          fontSize:   '0.68rem',
          color:      'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
        }}>
          Usuário de teste: player / player123
        </p>

        {/* Provably fair badge */}
        <div style={{
          marginTop:    24,
          padding:      '8px 12px',
          background:   'rgba(0,170,255,0.06)',
          border:       '1px solid rgba(0,170,255,0.2)',
          borderRadius: 6,
          fontSize:     '0.65rem',
          color:        'var(--neon-blue)',
          fontFamily:   'var(--font-mono)',
          letterSpacing: '0.06em',
        }}>
          🔐 PROVABLY FAIR · HMAC-SHA256
        </div>
      </div>
    </div>
  );
}
