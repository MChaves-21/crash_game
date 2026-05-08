import { describe, it, expect, beforeEach } from 'bun:test';
import { Wallet } from '../../src/domain/wallet/wallet.aggregate';
import { Money, InsufficientFundsError } from '../../src/domain/value-objects/money.vo';

function makeWallet(balanceDecimal = 1000): Wallet {
  return Wallet.create({
    id:             `w-${Math.random().toString(36).slice(2)}`,
    playerId:       `player-${Math.random().toString(36).slice(2)}`,
    initialBalance: Money.fromDecimal(balanceDecimal),
  });
}

describe('Wallet — operações de saldo', () => {
  let wallet: Wallet;
  beforeEach(() => { wallet = makeWallet(500); }); // R$ 500,00

  describe('debit', () => {
    it('deve debitar saldo corretamente', () => {
      wallet.debit(Money.fromDecimal(150), 'ref-001', 'teste');
      expect(wallet.balance.cents).toBe(35_000n); // 500 - 150 = 350
    });

    it('deve debitar o saldo exato (sem centavo sobrando)', () => {
      wallet.debit(Money.fromDecimal(500), 'ref-002', 'tudo');
      expect(wallet.balance.cents).toBe(0n);
    });

    it('deve lançar InsufficientFundsError para saldo insuficiente', () => {
      expect(() =>
        wallet.debit(Money.fromDecimal(500.01), 'ref-003', 'acima do saldo'),
      ).toThrow(InsufficientFundsError);
    });

    it('saldo não deve mudar após falha no débito', () => {
      const before = wallet.balance.cents;
      try { wallet.debit(Money.fromDecimal(9999), 'r', 'x'); } catch {}
      expect(wallet.balance.cents).toBe(before);
    });

    it('deve suportar múltiplos débitos sequenciais', () => {
      wallet.debit(Money.fromDecimal(100), 'r1', 'x');
      wallet.debit(Money.fromDecimal(100), 'r2', 'x');
      wallet.debit(Money.fromDecimal(100), 'r3', 'x');
      expect(wallet.balance.cents).toBe(20_000n); // 500 - 300 = 200
    });
  });

  describe('credit', () => {
    it('deve creditar saldo corretamente', () => {
      wallet.credit(Money.fromDecimal(250), 'ref-004', 'payout');
      expect(wallet.balance.cents).toBe(75_000n); // 500 + 250 = 750
    });

    it('deve suportar crédito em saldo zero', () => {
      const empty = makeWallet(0);
      empty.credit(Money.fromDecimal(100), 'ref-005', 'primeiro crédito');
      expect(empty.balance.cents).toBe(10_000n);
    });

    it('deve suportar crédito de valores grandes', () => {
      wallet.credit(Money.fromDecimal(999_000), 'ref-006', 'jackpot');
      expect(wallet.balance.cents).toBe(99_950_000n);
    });
  });

  describe('precisão monetária — BigInt', () => {
    it('não deve ter erro de ponto flutuante em 0.1 + 0.2', () => {
      const a = Money.fromDecimal(0.10);
      const b = Money.fromDecimal(0.20);
      expect(a.add(b).cents).toBe(30n);
      expect(a.add(b).toDecimal()).toBe(0.30);
    });

    it('R$ 1.000,00 × 100x deve ser R$ 100.000,00', () => {
      const bet = Money.fromDecimal(1000);
      const pay = bet.multiplyByFactor(100);
      expect(pay.cents).toBe(10_000_000n);
    });

    it('centavos impares devem ser preservados', () => {
      const m = Money.fromDecimal(0.01); // 1 centavo
      expect(m.cents).toBe(1n);
    });

    it('saldo nunca deve ser negativo independente da ordem das ops', () => {
      for (let i = 0; i < 50; i++) {
        const w = makeWallet(Math.random() * 1000);
        try {
          w.debit(Money.fromDecimal(Math.random() * 2000), `r-${i}`, 'x');
        } catch {}
        expect(w.balance.cents).toBeGreaterThanOrEqual(0n);
      }
    });

    it('multiplyByFactor com 0.01x deve retornar 1 centavo para R$ 1,00', () => {
      const m = Money.fromDecimal(1.00);
      const r = m.multiplyByFactor(0.01);
      expect(r.cents).toBe(1n);
    });
  });

  describe('transações pendentes', () => {
    it('deve acumular transações de débito e crédito', () => {
      wallet.debit(Money.fromDecimal(50), 'bet-1', 'aposta');
      wallet.credit(Money.fromDecimal(120), 'cashout-1', 'payout 2.4x');
      wallet.debit(Money.fromDecimal(30), 'bet-2', 'aposta 2');

      const txs = wallet.pullPendingTransactions();
      expect(txs).toHaveLength(3);
      expect(txs[0].type).toBe('DEBIT');
      expect(txs[1].type).toBe('CREDIT');
      expect(txs[2].type).toBe('DEBIT');
    });

    it('deve limpar fila após pull', () => {
      wallet.debit(Money.fromDecimal(10), 'r', 'x');
      wallet.pullPendingTransactions();
      expect(wallet.pullPendingTransactions()).toHaveLength(0);
    });

    it('cada transação deve conter o saldo após a operação', () => {
      wallet.debit(Money.fromDecimal(200), 'ref-d', 'debit');
      wallet.credit(Money.fromDecimal(300), 'ref-c', 'credit');

      const [tx1, tx2] = wallet.pullPendingTransactions();
      expect(tx1.balanceAfter.cents).toBe(30_000n); // 500 - 200 = 300
      expect(tx2.balanceAfter.cents).toBe(60_000n); // 300 + 300 = 600
    });

    it('referenceId deve ser preservado para idempotência', () => {
      const REF = 'unique-bet-id-abc123';
      wallet.debit(Money.fromDecimal(10), REF, 'teste');
      const [tx] = wallet.pullPendingTransactions();
      expect(tx.referenceId).toBe(REF);
    });
  });

  describe('canAfford', () => {
    it('deve retornar true para saldo exato', () => {
      expect(wallet.canAfford(Money.fromDecimal(500))).toBe(true);
    });

    it('deve retornar false para 1 centavo acima', () => {
      expect(wallet.canAfford(Money.fromDecimal(500.01))).toBe(false);
    });

    it('deve retornar true para zero', () => {
      expect(wallet.canAfford(Money.ZERO)).toBe(true);
    });
  });

  describe('reconstitute', () => {
    it('deve reconstituir identicamente ao original', () => {
      wallet.debit(Money.fromDecimal(100), 'r', 'x');
      wallet.pullPendingTransactions(); // limpa pendentes

      const snap         = wallet.toSnapshot();
      const reconstituted = Wallet.reconstitute(snap);

      expect(reconstituted.id).toBe(wallet.id);
      expect(reconstituted.playerId).toBe(wallet.playerId);
      expect(reconstituted.balance.cents).toBe(wallet.balance.cents);
    });

    it('reconstituted não deve ter transações pendentes', () => {
      wallet.debit(Money.fromDecimal(50), 'r', 'x');
      // Não faz pull — as txs existem no original
      const reconstituted = Wallet.reconstitute(wallet.toSnapshot());
      expect(reconstituted.pullPendingTransactions()).toHaveLength(0);
    });
  });
});
