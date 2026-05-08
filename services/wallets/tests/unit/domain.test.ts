import { describe, it, expect, beforeEach } from 'bun:test';
import { Wallet } from '../../src/domain/wallet/wallet.aggregate';
import { Money, InsufficientFundsError } from '../../src/domain/value-objects/money.vo';

// ── Factory de teste ──────────────────────────────────────────────────────────

function makeWallet(initialBalance = 1000): Wallet {
  return Wallet.create({
    id:             'wallet-001',
    playerId:       'player-001',
    initialBalance: Money.fromDecimal(initialBalance),
  });
}

// ── Wallet ────────────────────────────────────────────────────────────────────

describe('Wallet', () => {
  let wallet: Wallet;

  beforeEach(() => {
    wallet = makeWallet(500); // R$ 500,00
  });

  it('deve criar carteira com saldo inicial correto', () => {
    expect(wallet.balance.cents).toBe(50_000n);
    expect(wallet.balance.toDecimal()).toBe(500);
  });

  it('deve debitar saldo corretamente', () => {
    wallet.debit(Money.fromDecimal(100), 'bet-001', 'Aposta rodada 1');

    expect(wallet.balance.cents).toBe(40_000n); // 500 - 100 = 400
  });

  it('deve creditar saldo corretamente', () => {
    wallet.credit(Money.fromDecimal(250), 'cashout-001', 'Cashout 2.5x');

    expect(wallet.balance.cents).toBe(75_000n); // 500 + 250 = 750
  });

  it('deve lançar InsufficientFundsError ao debitar mais que o saldo', () => {
    expect(() =>
      wallet.debit(Money.fromDecimal(600), 'bet-002', 'Aposta acima do saldo'),
    ).toThrow(InsufficientFundsError);
  });

  it('saldo nunca deve ficar negativo', () => {
    try {
      wallet.debit(Money.fromDecimal(600), 'bet-003', 'Aposta inválida');
    } catch {}
    expect(wallet.balance.cents).toBeGreaterThanOrEqual(0n);
  });

  it('deve acumular transações pendentes', () => {
    wallet.debit(Money.fromDecimal(50), 'bet-004', 'Aposta 1');
    wallet.credit(Money.fromDecimal(120), 'cashout-002', 'Cashout');

    const pending = wallet.pullPendingTransactions();
    expect(pending).toHaveLength(2);
    expect(pending[0].type).toBe('DEBIT');
    expect(pending[1].type).toBe('CREDIT');
  });

  it('deve limpar transações pendentes após pull', () => {
    wallet.debit(Money.fromDecimal(10), 'bet-005', 'Aposta');
    wallet.pullPendingTransactions();

    const pending = wallet.pullPendingTransactions();
    expect(pending).toHaveLength(0);
  });

  it('deve registrar saldo após operação em cada transação', () => {
    wallet.debit(Money.fromDecimal(200), 'bet-006', 'Aposta');
    const [tx] = wallet.pullPendingTransactions();

    expect(tx.balanceAfter.cents).toBe(30_000n); // 500 - 200 = 300
  });

  it('canAfford deve retornar true para saldo suficiente', () => {
    expect(wallet.canAfford(Money.fromDecimal(500))).toBe(true);
    expect(wallet.canAfford(Money.fromDecimal(500.01))).toBe(false);
  });

  it('deve preservar referenceId na transação para idempotência', () => {
    wallet.credit(Money.fromDecimal(50), 'ref-unico-123', 'Cashout teste');
    const [tx] = wallet.pullPendingTransactions();
    expect(tx.referenceId).toBe('ref-unico-123');
  });

  it('deve serializar corretamente via toSnapshot', () => {
    const snap = wallet.toSnapshot();
    expect(snap.playerId).toBe('player-001');
    expect(snap.balance.cents).toBe(50_000n);
  });

  it('deve reconstituir via reconstitute sem perder dados', () => {
    wallet.debit(Money.fromDecimal(100), 'bet-007', 'Teste');
    const snap       = wallet.toSnapshot();
    const reconstituted = Wallet.reconstitute(snap);

    expect(reconstituted.balance.cents).toBe(40_000n);
    expect(reconstituted.playerId).toBe('player-001');
  });
});

// ── Money (compartilhado com Wallet Service) ──────────────────────────────────

describe('Money — precisão monetária', () => {
  it('deve evitar imprecisão de ponto flutuante', () => {
    // 0.1 + 0.2 em float = 0.30000000000000004
    // Em centavos BigInt: 10 + 20 = 30 (exato)
    const a = Money.fromDecimal(0.10);
    const b = Money.fromDecimal(0.20);
    expect(a.add(b).cents).toBe(30n);
    expect(a.add(b).toDecimal()).toBe(0.30);
  });

  it('deve multiplicar grande valor sem overflow', () => {
    // R$ 1.000,00 × 100x = R$ 100.000,00
    const bet    = Money.fromDecimal(1000);
    const payout = bet.multiplyByFactor(100);
    expect(payout.cents).toBe(10_000_000n);
  });

  it('deve arredondar corretamente ao converter decimal', () => {
    // R$ 10.995 deve virar 1100 centavos (R$ 11,00)
    const m = Money.fromDecimal(10.995);
    expect(m.cents).toBe(1100n);
  });

  it('fromCents com número inteiro deve funcionar', () => {
    const m = Money.fromCents(9999);
    expect(m.cents).toBe(9999n);
    expect(m.toDecimal()).toBe(99.99);
  });

  it('toString deve formatar corretamente', () => {
    expect(Money.fromDecimal(1.05).toString()).toBe('R$ 1,05');
    expect(Money.fromDecimal(1000).toString()).toBe('R$ 1000,00');
  });
});
