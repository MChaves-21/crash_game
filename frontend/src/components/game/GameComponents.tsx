import { useEffect, useState } from 'react';
import { useGameStore, formatCents, formatMultiplier } from '../../stores/game.store';
import { useToastStore } from '../../hooks/useToast';

// ── CountdownTimer ────────────────────────────────────────────────────────────

export function CountdownTimer({ endsAt }: { endsAt: Date }) {
  const [ms, setMs] = useState(Math.max(0, endsAt.getTime() - Date.now()));

  useEffect(() => {
    const iv = setInterval(() => {
      const rem = Math.max(0, endsAt.getTime() - Date.now());
      setMs(rem);
      if (rem <= 0) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
  }, [endsAt]);

  const total   = 10_000;
  const pct     = ms / total;
  const radius  = 20;
  const circ    = 2 * Math.PI * radius;
  const offset  = circ * (1 - pct);
  const color   = ms < 3000 ? 'var(--neon-red)' : ms < 6000 ? 'var(--neon-amber)' : 'var(--neon-green)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                  background: 'var(--bg-dark)', borderRadius: 8,
                  padding: '8px 14px', border: '1px solid var(--border)' }}>
      <svg width={48} height={48} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={24} cy={24} r={radius} fill="none"
                stroke="var(--border-bright)" strokeWidth={3} />
        <circle cx={24} cy={24} r={radius} fill="none"
                stroke={color} strokeWidth={3}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s' }} />
      </svg>
      <div>
        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', fontFamily: 'var(--font-display)',
                      letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Apostas encerram em
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem',
                      color, fontWeight: 700, marginTop: 1 }}>
          {(ms / 1000).toFixed(1)}s
        </div>
      </div>
    </div>
  );
}

// ── BetsList ──────────────────────────────────────────────────────────────────

export function BetsList() {
  const { bets, playerId } = useGameStore();
  const betArr = Array.from(bets.values())
    .sort((a, b) => (b.amountCents > a.amountCents ? 1 : -1));

  return (
    <div className="panel flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-header flex items-center justify-between">
        <span>Apostas da rodada</span>
        <span style={{ color: 'var(--neon-green)' }}>{betArr.length}</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {betArr.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)',
                        fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            aguardando apostas...
          </div>
        )}
        {betArr.map(bet => (
          <div
            key={bet.betId}
            className={`bet-row ${bet.status === 'CASHED_OUT' ? 'cashed-out' : bet.status === 'LOST' ? 'lost' : ''}`}
            style={{ borderLeft: bet.playerId === playerId ? '2px solid var(--neon-amber)' : undefined }}
          >
            {/* Avatar inicial */}
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: `hsl(${hashCode(bet.username) % 360}, 60%, 35%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 700, color: '#fff',
            }}>
              {bet.username.slice(0, 2).toUpperCase()}
            </div>

            {/* Username */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.78rem',
                            color: 'var(--text-primary)', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bet.username}
                {bet.playerId === playerId && (
                  <span style={{ marginLeft: 4, fontSize: '0.6rem',
                                 color: 'var(--neon-amber)' }}>EU</span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                            color: 'var(--text-dim)' }}>
                {formatCents(bet.amountCents)}
              </div>
            </div>

            {/* Status / payout */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {bet.status === 'CASHED_OUT' && bet.multiplier && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                              color: 'var(--neon-green)', fontWeight: 700 }}>
                  {formatMultiplier(bet.multiplier)}
                </div>
              )}
              {bet.status === 'CASHED_OUT' && bet.payoutCents !== undefined && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem',
                              color: 'var(--neon-green-dim)' }}>
                  {formatCents(bet.payoutCents!)}
                </div>
              )}
              {bet.status === 'PENDING' && (
                <div style={{ width: 8, height: 8, borderRadius: '50%',
                              background: 'var(--neon-amber)',
                              animation: 'glow-pulse 1.5s infinite' }} />
              )}
              {bet.status === 'LOST' && (
                <div style={{ color: 'var(--neon-red)', fontSize: '0.7rem' }}>✗</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── RoundHistory ──────────────────────────────────────────────────────────────

export function RoundHistory() {
  const { history } = useGameStore();

  function chipClass(v: number) {
    if (v >= 10)  return 'moon';
    if (v >= 3)   return 'high';
    if (v >= 2)   return 'mid';
    return 'low';
  }

  return (
    <div className="panel">
      <div className="panel-header">Histórico</div>
      <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {history.length === 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            sem histórico ainda
          </span>
        )}
        {history.map((h, i) => (
          <span
            key={h.roundId}
            className={`history-chip ${chipClass(h.crashPoint)}`}
            title={`Round ${h.roundId.slice(0, 8)}`}
            style={{ animation: i === 0 ? 'fade-in-up 0.3s ease' : undefined }}
          >
            {formatMultiplier(h.crashPoint)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── ToastContainer ────────────────────────────────────────────────────────────

export function ToastContainer() {
  const { toasts, remove } = useToastStore();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
