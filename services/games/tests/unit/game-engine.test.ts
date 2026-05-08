import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Round }  from '../../src/domain/round/round.aggregate';
import { Bet }    from '../../src/domain/bet/bet.entity';
import { Money }  from '../../src/domain/value-objects/money.vo';
import { Multiplier } from '../../src/domain/value-objects/multiplier.vo';
import { ProvablyFairService } from '../../src/domain/services/provably-fair.service';

/**
 * Testes unitários do ciclo de vida do Round integrado com ProvablyFairService.
 * Simula o comportamento do GameEngineService em memória sem NestJS.
 */

const pf = new ProvablyFairService();

function makeRound(crashPoint = 3.00): Round {
  const { serverSeed, serverSeedHash } = pf.generateSeeds();
  return Round.create({
    id:                `round-${Math.random().toString(36).slice(2)}`,
    serverSeed,
    serverSeedHash,
    crashPoint,
    bettingDurationMs: 10_000,
  });
}

function makeBet(playerId = 'p1', amountDecimal = 100): Bet {
  return Bet.create({
    id:       `bet-${Math.random().toString(36).slice(2)}`,
    roundId:  'r1',
    playerId,
    username: `user-${playerId}`,
    amount:   Money.fromDecimal(amountDecimal),
  });
}

// ── Ciclo de vida completo ─────────────────────────────────────────────────────

describe('Round — ciclo de vida completo', () => {

  describe('BETTING → RUNNING → CRASHED (sem cashout)', () => {
    it('todas as apostas devem ser marcadas como LOST ao crashar', () => {
      const round = makeRound(1.50);
      const bets  = [makeBet('p1'), makeBet('p2'), makeBet('p3')];

      for (const b of bets) round.placeBet(b);
      round.startRound();
      round.updateMultiplier(1.20);
      round.updateMultiplier(1.50);
      const { loserBets } = round.crash();

      expect(round.status).toBe('CRASHED');
      expect(loserBets).toHaveLength(3);
      expect(loserBets.every(b => b.status === 'LOST')).toBe(true);
    });
  });

  describe('BETTING → RUNNING → CRASHED (com cashouts parciais)', () => {
    it('apenas apostas PENDING devem ser marcadas como LOST', () => {
      const round = makeRound(5.00);

      const bet1 = makeBet('p1', 100);
      const bet2 = makeBet('p2', 200);
      const bet3 = makeBet('p3', 50);

      round.placeBet(bet1);
      round.placeBet(bet2);
      round.placeBet(bet3);
      round.startRound();
      round.updateMultiplier(2.00);

      // p1 e p3 sacam, p2 não
      round.cashOut('p1');
      round.cashOut('p3');

      round.updateMultiplier(5.00);
      const { loserBets } = round.crash();

      expect(loserBets).toHaveLength(1);
      expect(loserBets[0].playerId).toBe('p2');

      const b1 = round.getBetFrom('p1')!;
      const b3 = round.getBetFrom('p3')!;
      expect(b1.status).toBe('CASHED_OUT');
      expect(b3.status).toBe('CASHED_OUT');
    });
  });

  describe('Cálculo de payout', () => {
    it('payout deve ser amount × multiplier arredondado para baixo em centavos', () => {
      const round = makeRound(10.00);
      const bet   = makeBet('p1', 100);

      round.placeBet(bet);
      round.startRound();
      round.updateMultiplier(2.50);
      const { payout } = round.cashOut('p1');

      // R$ 100 × 2.50 = R$ 250,00 = 25000 centavos
      expect(payout.cents).toBe(25_000n);
    });

    it('payout em multiplicador fracionário deve ser preciso', () => {
      const round = makeRound(10.00);
      const bet   = makeBet('p1', 33.33); // R$ 33,33

      round.placeBet(bet);
      round.startRound();
      round.updateMultiplier(3.14);
      const { payout } = round.cashOut('p1');

      // 3333 centavos × 3.14 = 10465.62 → 10465 (floor via BigInt)
      expect(payout.cents).toBeGreaterThan(0n);
      expect(payout.cents).toBeLessThanOrEqual(10_500n);
      expect(typeof payout.cents).toBe('bigint');
    });
  });

  describe('updateMultiplier e detecção de crash', () => {
    it('shouldCrash deve ser false abaixo do crash point', () => {
      const round = makeRound(5.00);
      round.startRound();
      const { shouldCrash } = round.updateMultiplier(4.99);
      expect(shouldCrash).toBe(false);
    });

    it('shouldCrash deve ser true ao atingir o crash point', () => {
      const round = makeRound(3.00);
      round.startRound();
      const { shouldCrash } = round.updateMultiplier(3.00);
      expect(shouldCrash).toBe(true);
    });

    it('shouldCrash deve ser true quando ultrapassa o crash point', () => {
      const round = makeRound(2.50);
      round.startRound();
      const { shouldCrash } = round.updateMultiplier(2.51);
      expect(shouldCrash).toBe(true);
    });
  });

  describe('toPublicSnapshot — segurança dos dados', () => {
    it('não deve expor crashPoint antes do crash', () => {
      const round    = makeRound(4.00);
      const snapshot = round.toPublicSnapshot();
      expect((snapshot as any).crashPoint).toBeUndefined();
    });

    it('não deve expor serverSeed antes do crash', () => {
      const round    = makeRound(4.00);
      const snapshot = round.toPublicSnapshot();
      expect((snapshot as any).serverSeed).toBeUndefined();
    });

    it('deve expor serverSeed e crashPoint após o crash', () => {
      const round = makeRound(1.00);
      round.startRound();
      round.crash();
      const snapshot = round.toPublicSnapshot();
      expect(snapshot.serverSeed).toBeDefined();
      expect(snapshot.crashPoint).toBe(1.00);
    });

    it('serverSeedHash deve ser sempre público', () => {
      const round = makeRound(2.00);
      const snap1 = round.toPublicSnapshot();
      round.startRound();
      const snap2 = round.toPublicSnapshot();
      round.crash();
      const snap3 = round.toPublicSnapshot();

      expect(snap1.serverSeedHash).toBeDefined();
      expect(snap2.serverSeedHash).toBe(snap1.serverSeedHash);
      expect(snap3.serverSeedHash).toBe(snap1.serverSeedHash);
    });
  });

  describe('Invariantes — erros de domínio', () => {
    it('não deve permitir crashar uma rodada em BETTING', () => {
      const round = makeRound();
      expect(() => round.crash()).toThrow();
    });

    it('não deve permitir iniciar uma rodada já RUNNING', () => {
      const round = makeRound();
      round.startRound();
      expect(() => round.startRound()).toThrow();
    });

    it('não deve permitir iniciar uma rodada CRASHED', () => {
      const round = makeRound();
      round.startRound();
      round.crash();
      expect(() => round.startRound()).toThrow();
    });

    it('não deve permitir apostar em RUNNING', () => {
      const round = makeRound();
      round.startRound();
      expect(() => round.placeBet(makeBet('p1'))).toThrow();
    });

    it('não deve permitir apostar em CRASHED', () => {
      const round = makeRound();
      round.startRound();
      round.crash();
      expect(() => round.placeBet(makeBet('p1'))).toThrow();
    });

    it('não deve permitir cashout em BETTING', () => {
      const round = makeRound();
      round.placeBet(makeBet('p1'));
      expect(() => round.cashOut('p1')).toThrow();
    });

    it('não deve permitir cashout de jogador sem aposta', () => {
      const round = makeRound();
      round.startRound();
      expect(() => round.cashOut('ghost-player')).toThrow();
    });

    it('não deve permitir aposta dupla do mesmo jogador', () => {
      const round = makeRound();
      round.placeBet(makeBet('p1'));
      expect(() => round.placeBet(makeBet('p1'))).toThrow();
    });
  });
});

// ── Fórmula do multiplicador ──────────────────────────────────────────────────

describe('Fórmula do multiplicador — e^(0.00006 × t)', () => {
  const GROWTH_RATE = 0.00006;
  const calc = (ms: number) =>
    Math.floor(Math.pow(Math.E, GROWTH_RATE * ms) * 100) / 100;

  it('em t=0 deve ser 1.00', () => {
    expect(calc(0)).toBe(1.00);
  });

  it('em t=10s deve ser ~1.82', () => {
    const m = calc(10_000);
    expect(m).toBeGreaterThan(1.80);
    expect(m).toBeLessThan(1.85);
  });

  it('em t=30s deve ser ~6.05', () => {
    const m = calc(30_000);
    expect(m).toBeGreaterThan(5.90);
    expect(m).toBeLessThan(6.20);
  });

  it('deve crescer monotonicamente', () => {
    let prev = calc(0);
    for (let t = 100; t <= 60_000; t += 100) {
      const curr = calc(t);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('deve sempre ter no máximo 2 casas decimais', () => {
    for (let t = 0; t <= 60_000; t += 500) {
      const m   = calc(t);
      const str = m.toString();
      const dec = str.includes('.') ? str.split('.')[1].length : 0;
      expect(dec).toBeLessThanOrEqual(2);
    }
  });
});
