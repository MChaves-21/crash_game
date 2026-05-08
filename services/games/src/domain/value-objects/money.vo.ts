/**
 * Value Object: Money
 *
 * Representa um valor monetário em centavos usando BigInt.
 * NUNCA use ponto flutuante para dinheiro — critério eliminatório do desafio.
 *
 * Exemplos:
 *   Money.fromDecimal(10.50) → 1050n centavos
 *   Money.fromCents(1050n)   → R$ 10,50
 */
export class Money {
  static readonly MIN_BET = new Money(100n);    // R$ 1,00
  static readonly MAX_BET = new Money(100000n); // R$ 1.000,00
  static readonly ZERO    = new Money(0n);

  private constructor(private readonly _cents: bigint) {
    if (_cents < 0n) {
      throw new NegativeMoneyError(_cents);
    }
  }

  // ── Factories ────────────────────────────────────────────────────────────

  static fromCents(cents: bigint | number): Money {
    const value = typeof cents === 'number' ? BigInt(Math.round(cents)) : cents;
    return new Money(value);
  }

  /**
   * Converte um decimal (ex: 10.50) para centavos inteiros.
   * Usa Math.round para evitar erros de representação em ponto flutuante.
   */
  static fromDecimal(amount: number): Money {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new InvalidMoneyAmountError(amount);
    }
    return new Money(BigInt(Math.round(amount * 100)));
  }

  // ── Operações ─────────────────────────────────────────────────────────────

  add(other: Money): Money {
    return new Money(this._cents + other._cents);
  }

  subtract(other: Money): Money {
    if (other._cents > this._cents) {
      throw new InsufficientFundsError(this, other);
    }
    return new Money(this._cents - other._cents);
  }

  /**
   * Multiplica o valor por um fator (ex: multiplicador de cashout).
   * Usa aritmética inteira para preservar precisão:
   *   payout = floor(cents × factor × 100) / 100
   *
   * Internamente: cents × factorCents / 100 (arredondado para baixo).
   */
  multiplyByFactor(factor: number): Money {
    if (factor < 0 || !Number.isFinite(factor)) {
      throw new InvalidFactorError(factor);
    }
    // Multiplica por 100 antes de dividir para manter precisão inteira
    const factorCents = BigInt(Math.round(factor * 100));
    return new Money((this._cents * factorCents) / 100n);
  }

  // ── Comparações ───────────────────────────────────────────────────────────

  isGreaterThan(other: Money): boolean       { return this._cents > other._cents; }
  isLessThan(other: Money): boolean          { return this._cents < other._cents; }
  isGreaterThanOrEq(other: Money): boolean   { return this._cents >= other._cents; }
  isLessThanOrEq(other: Money): boolean      { return this._cents <= other._cents; }
  equals(other: Money): boolean              { return this._cents === other._cents; }
  isZero(): boolean                          { return this._cents === 0n; }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** Retorna centavos como bigint — use este para persistência (BIGINT no banco). */
  get cents(): bigint { return this._cents; }

  /** Converte para número decimal apenas para exibição. Nunca use para cálculos. */
  toDecimal(): number { return Number(this._cents) / 100; }

  toString(): string {
    const reais    = this._cents / 100n;
    const centavos = this._cents % 100n;
    return `R$ ${reais},${centavos.toString().padStart(2, '0')}`;
  }
}

// ── Erros de domínio ──────────────────────────────────────────────────────────

export class NegativeMoneyError extends Error {
  constructor(cents: bigint) {
    super(`Valor monetário não pode ser negativo: ${cents}n centavos`);
    this.name = 'NegativeMoneyError';
  }
}

export class InvalidMoneyAmountError extends Error {
  constructor(amount: number) {
    super(`Valor monetário inválido: ${amount}`);
    this.name = 'InvalidMoneyAmountError';
  }
}

export class InsufficientFundsError extends Error {
  readonly available: Money;
  readonly required: Money;

  constructor(available: Money, required: Money) {
    super(
      `Saldo insuficiente: disponível ${available}, necessário ${required}`,
    );
    this.name = 'InsufficientFundsError';
    this.available = available;
    this.required  = required;
  }
}

export class InvalidFactorError extends Error {
  constructor(factor: number) {
    super(`Fator de multiplicação inválido: ${factor}`);
    this.name = 'InvalidFactorError';
  }
}
