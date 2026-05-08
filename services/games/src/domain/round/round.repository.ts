import { Round } from '../round/round.aggregate';
import { Bet }   from '../bet/bet.entity';

/**
 * Port: IRoundRepository
 *
 * Contrato que a camada de domínio define.
 * A implementação concreta fica em infrastructure/persistence/.
 *
 * Seguindo Ports & Adapters (Hexagonal Architecture):
 *  - O domínio depende desta interface (abstração)
 *  - A infraestrutura implementa esta interface (concreção)
 */
export interface IRoundRepository {
  /** Persiste uma nova rodada e suas apostas. */
  save(round: Round): Promise<void>;

  /** Atualiza o estado de uma rodada existente. */
  update(round: Round): Promise<void>;

  /** Busca rodada pelo ID. */
  findById(id: string): Promise<Round | null>;

  /** Retorna a rodada atual (BETTING ou RUNNING). Nunca mais de uma ao mesmo tempo. */
  findCurrent(): Promise<Round | null>;

  /**
   * Retorna histórico paginado de rodadas finalizadas (CRASHED).
   * Ordenado por crashedAt DESC.
   */
  findHistory(params: PaginationParams): Promise<PaginatedResult<Round>>;
}

/**
 * Port: IBetRepository
 *
 * Separado do Round para permitir queries diretas em apostas
 * (ex: histórico de apostas do jogador).
 */
export interface IBetRepository {
  /** Persiste uma nova aposta. */
  save(bet: Bet): Promise<void>;

  /** Atualiza status/payout de uma aposta existente. */
  update(bet: Bet): Promise<void>;

  /** Busca aposta pelo ID. */
  findById(id: string): Promise<Bet | null>;

  /**
   * Retorna histórico paginado de apostas de um jogador.
   * Ordenado por placedAt DESC.
   */
  findByPlayer(playerId: string, params: PaginationParams): Promise<PaginatedResult<Bet>>;

  /** Busca aposta de um jogador em uma rodada específica. */
  findByPlayerAndRound(playerId: string, roundId: string): Promise<Bet | null>;
}

// ── Tipos utilitários ─────────────────────────────────────────────────────────

export interface PaginationParams {
  page:  number;  // 1-based
  limit: number;  // max 100
}

export interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
