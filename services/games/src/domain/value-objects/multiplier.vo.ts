/**
 * Value Object: Multiplier
 *
 * Representa o multiplicador de uma rodada (ex: 1.00x, 2.50x, 100.00x).
 * Sempre começa em 1.00 e cresce continuamente até o crash point.
 */
export class Multiplier {
  static readonly INITIAL  = new Multiplier(1.00);
  static readonly DECIMALS = 2;

  private constructor(private readonly _value: number) {
    if (!Number.isFinite(_value) || _value < 1.0) {
      throw new InvalidMultiplierError(_value);
    }
  }

  static of(value: number): Multiplier {
    const rounded = parseFloat(value.toFixed(Multiplier.DECIMALS));
    return new Multiplier(rounded);
  }

  isGreaterThan(other: Multiplier): boolean { return this._value > other._value; }
  isLessThan(other: Multiplier): boolean    { return this._value < other._value; }
  equals(other: Multiplier): boolean        { return this._value === other._value; }

  get value(): number { return this._value; }

  toString(): string { return `${this._value.toFixed(Multiplier.DECIMALS)}x`; }
}

export class InvalidMultiplierError extends Error {
  constructor(value: number) {
    super(`Multiplicador inválido: ${value}. Deve ser >= 1.00`);
    this.name = 'InvalidMultiplierError';
  }
}
