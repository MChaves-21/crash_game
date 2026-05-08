import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, formatCents, formatMultiplier } from '../stores/game.store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  useGameStore.setState({
    roundId: null, status: 'IDLE', multiplier: 1.00,
    serverSeedHash: null, bettingEndsAt: null,
    bets: new Map(), history: [], myBet: null,
    balanceCents: 0n, playerId: null, username: null,
    wsConnected: false, countdownMs: 0,
  });
}

// ── Formatadores ──────────────────────────────────────────────────────────────

describe('formatCents', () => {
  it('deve formatar zero', () => {
    expect(formatCents(0n)).toBe('R$ 0,00');
  });
  it('deve formatar centavos corretamente', () => {
    expect(formatCents(150n)).toBe('R$ 1,50');
  });
  it('deve formatar valores grandes', () => {
    expect(formatCents(100000n)).toBe('R$ 1.000,00');
  });
  it('deve formatar 1 centavo', () => {
    expect(formatCents(1n)).toBe('R$ 0,01');
  });
});

describe('formatMultiplier', () => {
  it('deve formatar com 2 casas decimais', () => {
    expect(formatMultiplier(1)).toBe('1.00x');
    expect(formatMultiplier(2.5)).toBe('2.50x');
    expect(formatMultiplier(100)).toBe('100.00x');
  });
});

// ── Store de jogo ─────────────────────────────────────────────────────────────

describe('useGameStore', () => {
  beforeEach(resetStore);

  describe('onRoundNew', () => {
    it('deve resetar estado e abrir fase de apostas', () => {
      const store = useGameStore.getState();
      store.onRoundNew({
        roundId:           'round-001',
        serverSeedHash:    'abc123',
        bettingEndsAt:     new Date(Date.now() + 10_000).toISOString(),
        bettingDurationMs: 10_000,
      });

      const s = useGameStore.getState();
      expect(s.roundId).toBe('round-001');
      expect(s.status).toBe('BETTING');
      expect(s.multiplier).toBe(1.00);
      expect(s.serverSeedHash).toBe('abc123');
      expect(s.bets.size).toBe(0);
      expect(s.myBet).toBeNull();
    });

    it('deve limpar apostas da rodada anterior', () => {
      const store = useGameStore.getState();
      // Simula apostas na rodada anterior
      store.onBetPlaced({ roundId: 'old', betId: 'b1', playerId: 'p1', username: 'user1', amountCents: '1000' });

      store.onRoundNew({
        roundId: 'round-002', serverSeedHash: 'xyz',
        bettingEndsAt: new Date(Date.now() + 10_000).toISOString(),
        bettingDurationMs: 10_000,
      });

      expect(useGameStore.getState().bets.size).toBe(0);
    });
  });

  describe('onBettingEnd', () => {
    it('deve mudar status para RUNNING', () => {
      useGameStore.getState().onRoundNew({
        roundId: 'r1', serverSeedHash: 'h1',
        bettingEndsAt: new Date().toISOString(), bettingDurationMs: 0,
      });
      useGameStore.getState().onBettingEnd({ roundId: 'r1' });
      expect(useGameStore.getState().status).toBe('RUNNING');
    });
  });

  describe('onMultiplierTick', () => {
    it('deve atualizar o multiplicador', () => {
      useGameStore.getState().onMultiplierTick({ roundId: 'r1', multiplier: 3.47, elapsedMs: 20000 });
      expect(useGameStore.getState().multiplier).toBe(3.47);
    });
  });

  describe('onBetPlaced', () => {
    it('deve adicionar aposta ao mapa de bets', () => {
      useGameStore.getState().onBetPlaced({
        roundId: 'r1', betId: 'bet-001',
        playerId: 'p1', username: 'player1', amountCents: '5000',
      });

      const { bets } = useGameStore.getState();
      expect(bets.size).toBe(1);
      const bet = bets.get('bet-001')!;
      expect(bet.amountCents).toBe(5000n);
      expect(bet.status).toBe('PENDING');
    });
  });

  describe('onBetCashout', () => {
    it('deve marcar aposta como CASHED_OUT com payout', () => {
      const store = useGameStore.getState();
      store.onBetPlaced({
        roundId: 'r1', betId: 'bet-002',
        playerId: 'p2', username: 'player2', amountCents: '10000',
      });
      store.onBetCashout({
        roundId: 'r1', betId: 'bet-002',
        playerId: 'p2', username: 'player2',
        multiplier: 2.50, payoutCents: '25000',
      });

      const bet = useGameStore.getState().bets.get('bet-002')!;
      expect(bet.status).toBe('CASHED_OUT');
      expect(bet.multiplier).toBe(2.50);
      expect(bet.payoutCents).toBe(25000n);
    });

    it('deve atualizar saldo do jogador no cashout', () => {
      useGameStore.setState({ playerId: 'mine', balanceCents: 90000n });
      const store = useGameStore.getState();

      store.onBetPlaced({
        roundId: 'r1', betId: 'bet-mine',
        playerId: 'mine', username: 'me', amountCents: '10000',
      });
      store.onBetCashout({
        roundId: 'r1', betId: 'bet-mine',
        playerId: 'mine', username: 'me',
        multiplier: 3.00, payoutCents: '30000',
      });

      // Saldo deve aumentar pelo payout
      expect(useGameStore.getState().balanceCents).toBe(120000n);
    });
  });

  describe('onRoundCrashed', () => {
    it('deve marcar apostas pendentes como LOST', () => {
      const store = useGameStore.getState();
      store.onBetPlaced({ roundId: 'r1', betId: 'b1', playerId: 'p1', username: 'u1', amountCents: '1000' });
      store.onBetPlaced({ roundId: 'r1', betId: 'b2', playerId: 'p2', username: 'u2', amountCents: '2000' });
      // p2 faz cashout
      store.onBetCashout({ roundId: 'r1', betId: 'b2', playerId: 'p2', username: 'u2', multiplier: 2, payoutCents: '4000' });

      store.onRoundCrashed({ roundId: 'r1', crashPoint: 1.50, serverSeed: 'seed', serverSeedHash: 'hash' });

      const { bets, status } = useGameStore.getState();
      expect(status).toBe('CRASHED');
      expect(bets.get('b1')!.status).toBe('LOST');      // perdeu
      expect(bets.get('b2')!.status).toBe('CASHED_OUT'); // já tinha sacado
    });

    it('deve adicionar ao histórico', () => {
      useGameStore.getState().onRoundCrashed({
        roundId: 'r-hist', crashPoint: 4.20,
        serverSeed: 's', serverSeedHash: 'h',
      });

      const { history } = useGameStore.getState();
      expect(history[0].crashPoint).toBe(4.20);
      expect(history[0].roundId).toBe('r-hist');
    });

    it('histórico não deve ultrapassar 20 entradas', () => {
      const store = useGameStore.getState();
      for (let i = 0; i < 25; i++) {
        store.onRoundCrashed({
          roundId: `r-${i}`, crashPoint: i + 1,
          serverSeed: 's', serverSeedHash: 'h',
        });
      }
      expect(useGameStore.getState().history.length).toBeLessThanOrEqual(20);
    });
  });

  describe('setBalance / setPlayer', () => {
    it('deve atualizar saldo', () => {
      useGameStore.getState().setBalance(55555n);
      expect(useGameStore.getState().balanceCents).toBe(55555n);
    });

    it('deve atualizar dados do jogador', () => {
      useGameStore.getState().setPlayer('player-uuid', 'johndoe');
      const s = useGameStore.getState();
      expect(s.playerId).toBe('player-uuid');
      expect(s.username).toBe('johndoe');
    });
  });
});
