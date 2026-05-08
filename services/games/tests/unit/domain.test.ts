import { describe, it, expect, beforeEach } from 'bun:test';
import { Money, InsufficientFundsError } from '../../src/domain/value-objects/money.vo';
import { Multiplier } from '../../src/domain/value-objects/multiplier.vo';
import { Bet } from '../../src/domain/bet/bet.entity';
import {
  Round,
  BettingClosedError,
  DuplicateBetError,
  CashoutNotAvailableError,
  NoBetFoundError,
} from '../../src/domain/round/round.aggregate';
import { ProvablyFairService } from '../../src/domain/services/provably-fair.service';

// ── Factories de teste ────────────────────────────────────────────────────────

function makeBet(overrides?: Partial<{ playerId: string; amount: number }>): Bet {
  return Bet.create({
    id:       'bet-001',
    roundId:  'round-001',
    playerId: overrides?.playerId ?? 'player-001',
    username: 'testplayer',
    amount:   Money.fromDecimal(overrides?.amount ?? 100),
  });
}

function makeRound(overrides?: Partial<{ crashPoint: number; bettingMs: number }>): Round {
  const pf    = new ProvablyFairService();
  const seeds = pf.generateSeeds();
  return Round.create({
    id:                'round-001',
    serverSeed:        seeds.serverSeed,
    serverSeedHash:    seeds.serverSeedHash,
    crashPoint:        overrides?.crashPoint ?? 3.50,
    bettingDurationMs: overrides?.bettingMs ?? 10_000,
  });
}

// ── Money ─────────────────────────────────────────────────────────────────────

describe('Money', () => {
  it('deve criar a partir de decimal', () => {
    const m = Money.fromDecimal(10.50);
    expect(m.cents).toBe(1050n);
    expect(m.toDecimal()).toBe(10.5);
  });

  it('deve somar corretamente', () => {
    const a = Money.fromDecimal(10.50);
    const b = Money.fromDecimal(5.25);
    expect(a.add(b).cents).toBe(1575n);
  });

  it('deve subtrair corretamente', () => {
    const a = Money.fromDecimal(100);
    const b = Money.fromDecimal(30.50);
    expect(a.subtract(b).cents).toBe(6950n);
  });

  it('deve lançar erro ao subtrair valor maior que o disponível', () => {
    const a = Money.fromDecimal(10);
    const b = Money.fromDecimal(20);
    expect(() => a.subtract(b)).toThrow(InsufficientFundsError);
  });

  it('deve multiplicar por fator sem ponto flutuante', () => {
    const m      = Money.fromDecimal(100);
    const payout = m.multiplyByFactor(2.50);
    expect(payout.cents).toBe(25000n); // R$ 250,00
  });

  it('não deve permitir valor negativo', () => {
    expect(() => Money.fromCents(-1n)).toThrow();
  });

  it('MIN_BET deve ser R$ 1,00', () => {
    expect(Money.MIN_BET.cents).toBe(100n);
  });

  it('MAX_BET deve ser R$ 1.000,00', () => {
    expect(Money.MAX_BET.cents).toBe(100_000n);
  });
});

// ── Multiplier ────────────────────────────────────────────────────────────────

describe('Multiplier', () => {
  it('deve iniciar em 1.00x', () => {
    expect(Multiplier.INITIAL.value).toBe(1.00);
  });

  it('não deve permitir valores abaixo de 1.00', () => {
    expect(() => Multiplier.of(0.99)).toThrow();
  });

  it('deve comparar corretamente', () => {
    const a = Multiplier.of(2.50);
    const b = Multiplier.of(1.75);
    expect(a.isGreaterThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(true);
  });
});

// ── Bet ───────────────────────────────────────────────────────────────────────

describe('Bet', () => {
  it('deve criar aposta com status PENDING', () => {
    const bet = makeBet();
    expect(bet.status).toBe('PENDING');
    expect(bet.isPending).toBe(true);
  });

  it('deve rejeitar aposta abaixo do mínimo (R$ 1,00)', () => {
    expect(() => makeBet({ amount: 0.99 })).toThrow();
  });

  it('deve rejeitar aposta acima do máximo (R$ 1.000,00)', () => {
    expect(() => makeBet({ amount: 1000.01 })).toThrow();
  });

  it('deve calcular payout corretamente no cashout', () => {
    const bet = makeBet({ amount: 200 });
    bet.cashOut(Multiplier.of(3.50));

    expect(bet.status).toBe('CASHED_OUT');
    expect(bet.payout?.cents).toBe(70_000n); // 200 × 3.50 = 700 reais = 70000 centavos
    expect(bet.cashoutAt?.value).toBe(3.50);
  });

  it('deve marcar como LOST ao crashar', () => {
    const bet = makeBet();
    bet.markAsLost();

    expect(bet.status).toBe('LOST');
    expect(bet.isLost).toBe(true);
  });

  it('não deve permitir cashout após já liquidada', () => {
    const bet = makeBet();
    bet.markAsLost();
    expect(() => bet.cashOut(Multiplier.of(2.00))).toThrow();
  });

  it('não deve permitir marcar como LOST após cashout', () => {
    const bet = makeBet();
    bet.cashOut(Multiplier.of(1.50));
    expect(() => bet.markAsLost()).toThrow();
  });
});

// ── Round ─────────────────────────────────────────────────────────────────────

describe('Round', () => {
  let round: Round;
  let bet:   Bet;

  beforeEach(() => {
    round = makeRound({ crashPoint: 5.00 });
    bet   = makeBet({ playerId: 'player-001' });
  });

  it('deve iniciar em fase BETTING', () => {
    expect(round.status).toBe('BETTING');
    expect(round.isBetting).toBe(true);
  });

  it('deve aceitar aposta na fase BETTING', () => {
    round.placeBet(bet);
    expect(round.hasBetFrom('player-001')).toBe(true);
  });

  it('deve rejeitar aposta duplicada do mesmo jogador', () => {
    round.placeBet(bet);
    const dup = makeBet({ playerId: 'player-001' });
    expect(() => round.placeBet(dup)).toThrow(DuplicateBetError);
  });

  it('deve rejeitar aposta quando rodada está RUNNING', () => {
    round.startRound();
    expect(() => round.placeBet(bet)).toThrow(BettingClosedError);
  });

  it('deve transicionar BETTING → RUNNING', () => {
    round.startRound();
    expect(round.status).toBe('RUNNING');
    expect(round.isRunning).toBe(true);
  });

  it('deve executar cashout e calcular payout correto', () => {
    round.placeBet(bet);
    round.startRound();
    round.updateMultiplier(2.50);

    const { payout } = round.cashOut('player-001');
    expect(payout.cents).toBe(25_000n); // 100 reais × 2.50 = 250 reais = 25000 centavos

    const savedBet = round.getBetFrom('player-001')!;
    expect(savedBet.status).toBe('CASHED_OUT');
  });

  it('não deve permitir cashout sem aposta', () => {
    round.startRound();
    expect(() => round.cashOut('player-sem-aposta')).toThrow(NoBetFoundError);
  });

  it('não deve permitir cashout na fase BETTING', () => {
    round.placeBet(bet);
    expect(() => round.cashOut('player-001')).toThrow(CashoutNotAvailableError);
  });

  it('deve marcar apostas pendentes como LOST ao crashar', () => {
    const bet2 = makeBet({ playerId: 'player-002' });
    round.placeBet(bet);
    round.placeBet(bet2);
    round.startRound();
    round.updateMultiplier(1.50);

    // player-001 faz cashout, player-002 não
    round.cashOut('player-001');

    const { loserBets } = round.crash();

    expect(round.status).toBe('CRASHED');
    expect(loserBets).toHaveLength(1);
    expect(loserBets[0].playerId).toBe('player-002');
    expect(loserBets[0].status).toBe('LOST');
  });

  it('deve retornar CRASHED com transição RUNNING → CRASHED', () => {
    round.startRound();
    round.crash();
    expect(round.status).toBe('CRASHED');
    expect(round.isCrashed).toBe(true);
  });

  it('não deve expor serverSeed antes do crash', () => {
    const snapshot = round.toPublicSnapshot();
    expect((snapshot as any).serverSeed).toBeUndefined();
    expect((snapshot as any).crashPoint).toBeUndefined();
  });

  it('deve expor serverSeed e crashPoint após o crash', () => {
    round.startRound();
    round.crash();
    const snapshot = round.toPublicSnapshot();
    expect(snapshot.serverSeed).toBeDefined();
    expect(snapshot.crashPoint).toBeDefined();
  });
});

// ── ProvablyFair ──────────────────────────────────────────────────────────────

describe('ProvablyFairService', () => {
  const pf = new ProvablyFairService();

  it('deve gerar seeds únicas a cada chamada', () => {
    const s1 = pf.generateSeeds();
    const s2 = pf.generateSeeds();
    expect(s1.serverSeed).not.toBe(s2.serverSeed);
    expect(s1.serverSeedHash).not.toBe(s2.serverSeedHash);
  });

  it('deve calcular crash point de forma determinística', () => {
    const seed    = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
    const roundId = 'round-001';
    const crash1  = pf.calculateCrashPoint(seed, roundId);
    const crash2  = pf.calculateCrashPoint(seed, roundId);
    expect(crash1).toBe(crash2);
  });

  it('crash point deve ser >= 1.00', () => {
    for (let i = 0; i < 100; i++) {
      const { serverSeed } = pf.generateSeeds();
      const crash = pf.calculateCrashPoint(serverSeed, `round-${i}`);
      expect(crash).toBeGreaterThanOrEqual(1.00);
    }
  });

  it('deve verificar corretamente um crash point válido', () => {
    const { serverSeed } = pf.generateSeeds();
    const roundId        = 'round-verify-test';
    const crashPoint     = pf.calculateCrashPoint(serverSeed, roundId);
    const result         = pf.verify(serverSeed, roundId, crashPoint);

    expect(result.valid).toBe(true);
    expect(result.calculatedCrash).toBe(crashPoint);
  });

  it('deve rejeitar verificação com crash point incorreto', () => {
    const { serverSeed } = pf.generateSeeds();
    const roundId        = 'round-tamper-test';
    const result         = pf.verify(serverSeed, roundId, 99.99);

    // 99.99 provavelmente não é o crash point real
    const realCrash = pf.calculateCrashPoint(serverSeed, roundId);
    if (realCrash !== 99.99) {
      expect(result.valid).toBe(false);
    }
  });

  it('deve ter house edge de ~3% (1 em 33 crasham em 1.00x)', () => {
    let instantCrashes = 0;
    const total        = 1000;

    for (let i = 0; i < total; i++) {
      const { serverSeed } = pf.generateSeeds();
      const crash = pf.calculateCrashPoint(serverSeed, `round-${i}`);
      if (crash === 1.00) instantCrashes++;
    }

    const rate = instantCrashes / total;
    // Espera ~3% (0.03) com margem de erro
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.06);
  });
});
