import { Bet } from '../bet/bet.entity';
import { Money } from '../value-objects/money.vo';
import { Multiplier } from '../value-objects/multiplier.vo';

// ── Tipos e Enums ─────────────────────────────────────────────────────────────

export type RoundStatus = 'BETTING' | 'RUNNING' | 'CRASHED';

export interface RoundProps {
  id:              string;
  status:          RoundStatus;
  serverSeed:      string;       // revelado após crash
  serverSeedHash:  string;       // publicado antes das apostas (compromisso)
  crashPoint:      number;       // pré-calculado, mantido em segredo
  currentMultiplier: number;
  bets:            Map<string, Bet>; // playerId → Bet
  bettingEndsAt:   Date;
  startedAt?:      Date;
  crashedAt?:      Date;
  createdAt:       Date;
}

export interface RoundSnapshot {
  id:              string;
  status:          RoundStatus;
  serverSeedHash:  string;        // nunca expor serverSeed durante rodada ativa
  serverSeed?:     string;        // só após crash
  crashPoint?:     number;        // só após crash
  currentMultiplier: number;
  bets:            ReturnType<Bet['toSnapshot']>[];
  bettingEndsAt:   Date;
  startedAt?:      Date;
  crashedAt?:      Date;
  createdAt:       Date;
}

/**
 * Agregado Raiz: Round (Rodada)
 *
 * Gerencia o ciclo de vida completo de uma rodada do Crash Game.
 *
 * Máquina de estados:
 *   BETTING → RUNNING → CRASHED
 *
 * Invariantes:
 *  - Só aceita apostas em fase BETTING
 *  - Cada jogador pode ter no máximo uma aposta por rodada
 *  - Só aceita cashout em fase RUNNING
 *  - O crashPoint é pré-calculado e imutável
 *  - O serverSeed só é revelado após o crash
 */
export class Round {
  private _props: RoundProps;

  private constructor(props: RoundProps) {
    this._props = props;
  }

  // ── Factories ─────────────────────────────────────────────────────────────

  static create(params: {
    id:             string;
    serverSeed:     string;
    serverSeedHash: string;
    crashPoint:     number;
    bettingDurationMs: number;
  }): Round {
    const bettingEndsAt = new Date(Date.now() + params.bettingDurationMs);

    return new Round({
      id:                params.id,
      status:            'BETTING',
      serverSeed:        params.serverSeed,
      serverSeedHash:    params.serverSeedHash,
      crashPoint:        params.crashPoint,
      currentMultiplier: 1.00,
      bets:              new Map(),
      bettingEndsAt,
      createdAt:         new Date(),
    });
  }

  static reconstitute(props: RoundProps): Round {
    return new Round(props);
  }

  // ── Transições de estado ──────────────────────────────────────────────────

  /**
   * BETTING → RUNNING
   * Inicia a rodada — o multiplicador começa a subir.
   */
  startRound(): void {
    if (this._props.status !== 'BETTING') {
      throw new InvalidRoundTransitionError(this._props.status, 'RUNNING');
    }
    this._props.status    = 'RUNNING';
    this._props.startedAt = new Date();
    this._props.currentMultiplier = 1.00;
  }

  /**
   * Atualiza o multiplicador atual (chamado pelo game engine em intervalos).
   * Verifica se atingiu o crash point e lança o crash se necessário.
   */
  updateMultiplier(newValue: number): { shouldCrash: boolean } {
    if (this._props.status !== 'RUNNING') {
      throw new RoundNotRunningError(this._props.id);
    }

    this._props.currentMultiplier = parseFloat(newValue.toFixed(2));

    if (this._props.currentMultiplier >= this._props.crashPoint) {
      return { shouldCrash: true };
    }
    return { shouldCrash: false };
  }

  /**
   * RUNNING → CRASHED
   * Encerra a rodada. Todas as apostas PENDING são marcadas como LOST.
   * O serverSeed é revelado para verificação.
   */
  crash(): { loserBets: Bet[] } {
    if (this._props.status !== 'RUNNING') {
      throw new InvalidRoundTransitionError(this._props.status, 'CRASHED');
    }

    this._props.status    = 'CRASHED';
    this._props.crashedAt = new Date();

    const loserBets: Bet[] = [];
    for (const bet of this._props.bets.values()) {
      if (bet.isPending) {
        bet.markAsLost();
        loserBets.push(bet);
      }
    }

    return { loserBets };
  }

  // ── Ações de jogador ──────────────────────────────────────────────────────

  /**
   * Registra uma aposta na rodada.
   * Invariantes:
   *  - Rodada deve estar em fase BETTING
   *  - Jogador não pode apostar duas vezes
   */
  placeBet(bet: Bet): void {
    if (this._props.status !== 'BETTING') {
      throw new BettingClosedError(this._props.id, this._props.status);
    }
    if (this._props.bets.has(bet.playerId)) {
      throw new DuplicateBetError(bet.playerId, this._props.id);
    }
    this._props.bets.set(bet.playerId, bet);
  }

  /**
   * Executa o cashout de um jogador.
   * Invariantes:
   *  - Rodada deve estar em fase RUNNING
   *  - Jogador deve ter uma aposta na rodada
   */
  cashOut(playerId: string): { bet: Bet; payout: Money } {
    if (this._props.status !== 'RUNNING') {
      throw new CashoutNotAvailableError(this._props.id, this._props.status);
    }

    const bet = this._props.bets.get(playerId);
    if (!bet) {
      throw new NoBetFoundError(playerId, this._props.id);
    }

    const multiplier = Multiplier.of(this._props.currentMultiplier);
    bet.cashOut(multiplier);

    return { bet, payout: bet.payout! };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  hasBetFrom(playerId: string): boolean     { return this._props.bets.has(playerId); }
  getBetFrom(playerId: string): Bet | undefined { return this._props.bets.get(playerId); }
  getAllBets(): Bet[]                        { return [...this._props.bets.values()]; }
  getPendingBets(): Bet[]                   { return this.getAllBets().filter(b => b.isPending); }

  // ── Getters ───────────────────────────────────────────────────────────────

  get id():                string      { return this._props.id; }
  get status():            RoundStatus { return this._props.status; }
  get serverSeedHash():    string      { return this._props.serverSeedHash; }
  get currentMultiplier(): number      { return this._props.currentMultiplier; }
  get bettingEndsAt():     Date        { return this._props.bettingEndsAt; }
  get startedAt():         Date | undefined { return this._props.startedAt; }
  get crashedAt():         Date | undefined { return this._props.crashedAt; }
  get createdAt():         Date        { return this._props.createdAt; }
  get isBetting():         boolean     { return this._props.status === 'BETTING'; }
  get isRunning():         boolean     { return this._props.status === 'RUNNING'; }
  get isCrashed():         boolean     { return this._props.status === 'CRASHED'; }

  /**
   * Snapshot seguro para expor via API.
   * - Nunca expõe serverSeed nem crashPoint durante rodada ativa.
   * - Revela ambos apenas após crash.
   */
  toPublicSnapshot(): RoundSnapshot {
    const base: RoundSnapshot = {
      id:               this._props.id,
      status:           this._props.status,
      serverSeedHash:   this._props.serverSeedHash,
      currentMultiplier: this._props.currentMultiplier,
      bets:             this.getAllBets().map(b => b.toSnapshot()),
      bettingEndsAt:    this._props.bettingEndsAt,
      startedAt:        this._props.startedAt,
      crashedAt:        this._props.crashedAt,
      createdAt:        this._props.createdAt,
    };

    // Só revela seed e crash point após o fim da rodada
    if (this._props.status === 'CRASHED') {
      base.serverSeed = this._props.serverSeed;
      base.crashPoint = this._props.crashPoint;
    }

    return base;
  }

  /** Snapshot completo para persistência interna. */
  toInternalSnapshot(): RoundProps {
    return { ...this._props };
  }
}

// ── Erros de domínio ──────────────────────────────────────────────────────────

export class InvalidRoundTransitionError extends Error {
  constructor(from: RoundStatus, to: RoundStatus) {
    super(`Transição de estado inválida: ${from} → ${to}`);
    this.name = 'InvalidRoundTransitionError';
  }
}

export class RoundNotRunningError extends Error {
  constructor(roundId: string) {
    super(`Rodada ${roundId} não está em execução`);
    this.name = 'RoundNotRunningError';
  }
}

export class BettingClosedError extends Error {
  constructor(roundId: string, status: RoundStatus) {
    super(`Fase de apostas encerrada na rodada ${roundId}. Status: ${status}`);
    this.name = 'BettingClosedError';
  }
}

export class DuplicateBetError extends Error {
  constructor(playerId: string, roundId: string) {
    super(`Jogador ${playerId} já apostou na rodada ${roundId}`);
    this.name = 'DuplicateBetError';
  }
}

export class CashoutNotAvailableError extends Error {
  constructor(roundId: string, status: RoundStatus) {
    super(`Cashout indisponível na rodada ${roundId}. Status: ${status}`);
    this.name = 'CashoutNotAvailableError';
  }
}

export class NoBetFoundError extends Error {
  constructor(playerId: string, roundId: string) {
    super(`Jogador ${playerId} não tem aposta na rodada ${roundId}`);
    this.name = 'NoBetFoundError';
  }
}
