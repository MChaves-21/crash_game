import { Money } from '../value-objects/money.vo';
import { Multiplier } from '../value-objects/multiplier.vo';

// ── Tipos e Enums ─────────────────────────────────────────────────────────────

export type BetStatus = 'PENDING' | 'CASHED_OUT' | 'LOST';

export interface BetProps {
  id:             string;
  roundId:        string;
  playerId:       string;
  username:       string;
  amount:         Money;
  status:         BetStatus;
  cashoutAt?:     Multiplier;
  payout?:        Money;
  placedAt:       Date;
  cashedOutAt?:   Date;
}

/**
 * Entidade: Bet (Aposta)
 *
 * Representa a aposta de um jogador em uma rodada.
 * Invariantes de domínio:
 *  - Valor entre Money.MIN_BET e Money.MAX_BET
 *  - Só pode sacar uma vez (PENDING → CASHED_OUT)
 *  - Só pode perder uma vez (PENDING → LOST)
 *  - Payout = amount × multiplicador no momento do cashout
 */
export class Bet {
  private _props: BetProps;

  private constructor(props: BetProps) {
    this._props = props;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  static create(params: {
    id:       string;
    roundId:  string;
    playerId: string;
    username: string;
    amount:   Money;
  }): Bet {
    Bet.validateAmount(params.amount);

    return new Bet({
      ...params,
      status:    'PENDING',
      placedAt:  new Date(),
    });
  }

  /** Reconstitui uma Bet a partir de dados persistidos. */
  static reconstitute(props: BetProps): Bet {
    return new Bet(props);
  }

  // ── Transições de estado ──────────────────────────────────────────────────

  /**
   * Registra o cashout do jogador.
   * Invariante: só pode sacar se status === 'PENDING'.
   */
  cashOut(currentMultiplier: Multiplier): void {
    if (this._props.status !== 'PENDING') {
      throw new BetAlreadySettledError(this._props.id, this._props.status);
    }

    const payout = this._props.amount.multiplyByFactor(currentMultiplier.value);

    this._props = {
      ...this._props,
      status:       'CASHED_OUT',
      cashoutAt:    currentMultiplier,
      payout,
      cashedOutAt:  new Date(),
    };
  }

  /**
   * Marca a aposta como perdida (quando a rodada crasha).
   * Invariante: só perde se ainda estava PENDING.
   */
  markAsLost(): void {
    if (this._props.status !== 'PENDING') {
      throw new BetAlreadySettledError(this._props.id, this._props.status);
    }
    this._props = { ...this._props, status: 'LOST' };
  }

  // ── Validações ────────────────────────────────────────────────────────────

  private static validateAmount(amount: Money): void {
    if (amount.isLessThan(Money.MIN_BET)) {
      throw new BetBelowMinimumError(amount);
    }
    if (amount.isGreaterThan(Money.MAX_BET)) {
      throw new BetAboveMaximumError(amount);
    }
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get id():           string       { return this._props.id; }
  get roundId():      string       { return this._props.roundId; }
  get playerId():     string       { return this._props.playerId; }
  get username():     string       { return this._props.username; }
  get amount():       Money        { return this._props.amount; }
  get status():       BetStatus    { return this._props.status; }
  get cashoutAt():    Multiplier | undefined { return this._props.cashoutAt; }
  get payout():       Money | undefined      { return this._props.payout; }
  get placedAt():     Date         { return this._props.placedAt; }
  get cashedOutAt():  Date | undefined       { return this._props.cashedOutAt; }
  get isPending():    boolean      { return this._props.status === 'PENDING'; }
  get isCashedOut():  boolean      { return this._props.status === 'CASHED_OUT'; }
  get isLost():       boolean      { return this._props.status === 'LOST'; }

  toSnapshot(): BetProps { return { ...this._props }; }
}

// ── Erros de domínio ──────────────────────────────────────────────────────────

export class BetAlreadySettledError extends Error {
  constructor(betId: string, status: BetStatus) {
    super(`Aposta ${betId} já foi liquidada com status: ${status}`);
    this.name = 'BetAlreadySettledError';
  }
}

export class BetBelowMinimumError extends Error {
  constructor(amount: Money) {
    super(`Aposta abaixo do mínimo: ${amount}. Mínimo: ${Money.MIN_BET}`);
    this.name = 'BetBelowMinimumError';
  }
}

export class BetAboveMaximumError extends Error {
  constructor(amount: Money) {
    super(`Aposta acima do máximo: ${amount}. Máximo: ${Money.MAX_BET}`);
    this.name = 'BetAboveMaximumError';
  }
}
