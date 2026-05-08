/**
 * Value Object: Money — Wallet Service
 *
 * Cópia local do Money VO para manter os bounded contexts independentes.
 * Lógica idêntica ao Game Service — em produção extrair para @crash/shared.
 */
export class Money {
  static readonly ZERO = new Money(0n);

  private constructor(private readonly _cents: bigint) {
    if (_cents < 0n) throw new NegativeMoneyError(_cents);
  }

  static fromCents(cents: bigint | number): Money {
    const value = typeof cents === 'number' ? BigInt(Math.round(cents)) : cents;
    return new Money(value);
  }

  static fromDecimal(amount: number): Money {
    if (!Number.isFinite(amount) || amount < 0) throw new InvalidMoneyAmountError(amount);
    return new Money(BigInt(Math.round(amount * 100)));
  }

  add(other: Money): Money      { return new Money(this._cents + other._cents); }

  subtract(other: Money): Money {
    if (other._cents > this._cents) throw new InsufficientFundsError(this, other);
    return new Money(this._cents - other._cents);
  }

  isGreaterThan(other: Money): boolean     { return this._cents > other._cents; }
  isLessThan(other: Money): boolean        { return this._cents < other._cents; }
  isGreaterThanOrEq(other: Money): boolean { return this._cents >= other._cents; }
  equals(other: Money): boolean            { return this._cents === other._cents; }
  isZero(): boolean                        { return this._cents === 0n; }

  get cents(): bigint   { return this._cents; }
  toDecimal(): number   { return Number(this._cents) / 100; }
  toString(): string {
    return `R$ ${this._cents / 100n},${(this._cents % 100n).toString().padStart(2, '0')}`;
  }
}

export class NegativeMoneyError extends Error {
  constructor(cents: bigint) {
    super(`Valor monetário não pode ser negativo: ${cents}n`);
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
  readonly required:  Money;
  constructor(available: Money, required: Money) {
    super(`Saldo insuficiente: disponível ${available}, necessário ${required}`);
    this.name    = 'InsufficientFundsError';
    this.available = available;
    this.required  = required;
  }
}
