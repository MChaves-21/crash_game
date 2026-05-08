import { useState } from 'react';
import { useGameStore, formatCents, formatMultiplier } from '../../stores/game.store';
import { gameApi, ApiError } from '../../services/api';
import { useToast }          from '../../hooks/useToast';
import { CountdownTimer }    from './CountdownTimer';

export function BetControls() {
  const [amount, setAmount]   = useState('100');
  const [loading, setLoading] = useState(false);
  const toast   = useToast();
  const store   = useGameStore();

  const { status, myBet, balanceCents, multiplier, bettingEndsAt } = store;

  const canBet      = status === 'BETTING' && !myBet;
  const canCashOut  = status === 'RUNNING' && myBet?.status === 'PENDING';
  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const potentialPayout = myBet && status === 'RUNNING'
    ? myBet.amountCents * BigInt(Math.floor(multiplier * 100)) / 100n
    : null;

  async function handleBet() {
    if (!canBet || loading) return;
    if (amountCents < 100)   { toast.error('Aposta mínima: R$ 1,00'); return; }
    if (amountCents > 100000){ toast.error('Aposta máxima: R$ 1.000,00'); return; }
    if (BigInt(amountCents) > balanceCents) { toast.error('Saldo insuficiente'); return; }

    setLoading(true);
    try {
      const result = await gameApi.placeBet(amountCents);
      store.setMyBet({
        betId:       result.betId,
        playerId:    store.playerId!,
        username:    store.username!,
        amountCents: BigInt(amountCents),
        status:      'PENDING',
      });
      store.setBalance(balanceCents - BigInt(amountCents));
      toast.success(`Aposta de ${formatCents(BigInt(amountCents))} registrada!`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao apostar');
    } finally {
      setLoading(false);
    }
  }

  async function handleCashOut() {
    if (!canCashOut || loading) return;
    setLoading(true);
    try {
      const result = await gameApi.cashOut();
      toast.success(`Cashout! ${formatMultiplier(result.multiplier)} → ${formatCents(BigInt(result.payoutCents))}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro no cashout');
    } finally {
      setLoading(false);
    }
  }

  const quickAmounts = [10, 50, 100, 500];

  return (
    <div className="panel flex flex-col gap-4 p-4" style={{ minWidth: 280 }}>

      {/* Saldo */}
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-display)',
                      letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>
          Saldo disponível
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem',
                      color: 'var(--neon-green)', fontWeight: 700 }}>
          {formatCents(balanceCents)}
        </div>
      </div>

      {/* Timer de apostas */}
      {status === 'BETTING' && bettingEndsAt && (
        <CountdownTimer endsAt={bettingEndsAt} />
      )}

      {/* Input de valor */}
      <div>
        <label style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-display)',
                        letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
          Valor da aposta (R$)
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                         color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            R$
          </span>
          <input
            type="number"
            className="bet-input"
            style={{ paddingLeft: 36 }}
            value={amount}
            min="1"
            max="1000"
            step="1"
            onChange={e => setAmount(e.target.value)}
            disabled={!canBet || loading}
            placeholder="0,00"
          />
        </div>

        {/* Quick amounts */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {quickAmounts.map(v => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              disabled={!canBet}
              style={{
                flex: 1,
                padding: '5px 4px',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-bright)',
                borderRadius: 4,
                color: amount === String(v) ? 'var(--neon-green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                cursor: canBet ? 'pointer' : 'not-allowed',
                opacity: canBet ? 1 : 0.4,
                transition: 'all 0.15s',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Minha aposta ativa */}
      {myBet && (
        <div style={{
          background: 'var(--bg-dark)',
          border: `1px solid ${myBet.status === 'CASHED_OUT' ? 'var(--neon-green)' :
                                myBet.status === 'LOST'      ? 'var(--neon-red)' :
                                'var(--border-bright)'}`,
          borderRadius: 8,
          padding: '10px 14px',
        }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-dim)', fontFamily: 'var(--font-display)',
                        letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Minha aposta
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem',
                        color: 'var(--text-primary)' }}>
            {formatCents(myBet.amountCents)}
          </div>

          {myBet.status === 'PENDING' && potentialPayout && status === 'RUNNING' && (
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--neon-amber)',
                          fontFamily: 'var(--font-mono)' }}>
              Potencial: {formatCents(potentialPayout)}
            </div>
          )}

          {myBet.status === 'CASHED_OUT' && myBet.payoutCents && (
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--neon-green)',
                          fontFamily: 'var(--font-mono)' }}>
              ✓ Sacou {formatMultiplier(myBet.multiplier!)} → {formatCents(myBet.payoutCents)}
            </div>
          )}

          {myBet.status === 'LOST' && (
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--neon-red)',
                          fontFamily: 'var(--font-mono)' }}>
              ✗ Perdida
            </div>
          )}
        </div>
      )}

      {/* Botões de ação */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
        <button
          className="btn-bet w-full"
          onClick={handleBet}
          disabled={!canBet || loading}
        >
          {loading && canBet ? 'Registrando...' : 'Apostar'}
        </button>

        <button
          className="btn-cashout w-full"
          onClick={handleCashOut}
          disabled={!canCashOut || loading}
        >
          {canCashOut
            ? `Sacar ${potentialPayout ? formatCents(potentialPayout) : ''}`
            : 'Cash Out'}
        </button>
      </div>
    </div>
  );
}
