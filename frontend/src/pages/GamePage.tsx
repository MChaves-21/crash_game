import { useEffect } from 'react';
import { useQuery }  from '@tanstack/react-query';
import { useWebSocket }  from '../hooks/useWebSocket';
import { useGameStore }  from '../stores/game.store';
import { gameApi, walletApi, authApi } from '../services/api';
import { CrashGraph }    from '../components/game/CrashGraph';
import { BetControls }   from '../components/game/BetControls';
import { BetsList, RoundHistory, ToastContainer } from '../components/game/GameComponents';

export function GamePage() {
  useWebSocket(); // conecta WebSocket e alimenta o store

  const store = useGameStore();

  // ── Inicialização ──────────────────────────────────────────────────────

  useEffect(() => {
    // Decodifica JWT para extrair playerId e username
    const token = sessionStorage.getItem('access_token');
    if (token) {
      const payload = authApi.parseJwt(token);
      if (payload) {
        store.setPlayer(payload.sub, payload.preferred_username ?? payload.sub);
      }
    }
  }, []);

  // Carrega rodada atual ao montar
  useQuery({
    queryKey: ['currentRound'],
    queryFn:  gameApi.getCurrentRound,
    onSuccess: store.loadCurrentRound,
    staleTime: Infinity, // WebSocket mantém atualizado
  } as any);

  // Carrega histórico inicial
  useQuery({
    queryKey: ['history'],
    queryFn:  () => gameApi.getHistory(1, 20),
    onSuccess: (data: any) => {
      const entries = (data.data ?? []).map((r: any) => ({
        roundId:    r.id,
        crashPoint: r.crashPoint,
        crashedAt:  r.crashedAt,
      }));
      // Popula o histórico inicial no store
      store.history.length === 0 &&
        useGameStore.setState({ history: entries });
    },
  } as any);

  // Carrega saldo da carteira
  useQuery({
    queryKey: ['wallet'],
    queryFn:  walletApi.getMyWallet,
    onSuccess: (data: any) => {
      if (data?.balanceCents) store.setBalance(BigInt(data.balanceCents));
    },
    retry: false,
  } as any);

  // ── Layout ─────────────────────────────────────────────────────────────

  return (
    <>
      <ToastContainer />

      <div style={{
        minHeight: '100vh',
        display:   'flex',
        flexDirection: 'column',
        background: 'var(--bg-void)',
        padding:   '0',
      }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '12px 24px',
          borderBottom:   '1px solid var(--border)',
          background:     'var(--bg-dark)',
          backdropFilter: 'blur(12px)',
          position:       'sticky',
          top:            0,
          zIndex:         100,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              fontSize:   '1.4rem',
              letterSpacing: '-0.02em',
              color:      'var(--neon-green)',
              textShadow: 'var(--glow-green)',
            }}>
              🦧 JUNGLE
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 300,
              fontSize:   '1.4rem',
              color:      'var(--text-secondary)',
              letterSpacing: '0.1em',
            }}>
              CRASH
            </div>
          </div>

          {/* Status WS + Player info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* WebSocket status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: store.wsConnected ? 'var(--neon-green)' : 'var(--neon-red)',
                boxShadow:  store.wsConnected ? 'var(--glow-green)' : 'var(--glow-red)',
              }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)',
                             fontFamily: 'var(--font-mono)' }}>
                {store.wsConnected ? 'LIVE' : 'OFF'}
              </span>
            </div>

            {/* Player */}
            {store.username && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--neon-green), var(--neon-blue))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700, color: '#000',
                }}>
                  {store.username.slice(0, 2).toUpperCase()}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)',
                               fontFamily: 'var(--font-ui)' }}>
                  {store.username}
                </span>
                <button
                  onClick={authApi.logout}
                  style={{
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer',
                    fontSize: '0.65rem', padding: '3px 8px',
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
                  }}
                >
                  SAIR
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── Histórico (topo) ─────────────────────────────────────────── */}
        <div style={{ padding: '12px 24px 0' }}>
          <RoundHistory />
        </div>

        {/* ── Game area ────────────────────────────────────────────────── */}
        <div className="game-layout" style={{
          display:  'flex',
          flex:     1,
          gap:      16,
          padding:  '12px 24px 24px',
          minHeight: 0,
        }}>

          {/* Gráfico — principal */}
          <div style={{ flex: 1, position: 'relative', minHeight: 320 }}>
            <CrashGraph />
          </div>

          {/* Coluna lateral direita */}
          <div style={{
            display:       'flex',
            flexDirection: 'column',
            gap:           12,
            width:         300,
            flexShrink:    0,
          }}>
            <BetControls />
            <BetsList />
          </div>
        </div>

      </div>
    </>
  );
}
