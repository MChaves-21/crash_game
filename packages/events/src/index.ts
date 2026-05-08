/**
 * @package @crash/events
 *
 * Contrato único de eventos do RabbitMQ.
 * Compartilhado entre Game Service e Wallet Service.
 *
 * Exchange: crash.events (topic)
 * Padrão de routing key: <origem>.<entidade>.<evento>
 *
 * Fluxo de apostas:
 *   1. Game  → game.bet.placed      → Wallet debita saldo
 *   2. Wallet → wallet.debit.approved → Game confirma aposta
 *      Wallet → wallet.debit.rejected → Game cancela aposta
 *
 * Fluxo de cashout:
 *   3. Game  → game.bet.cashout     → Wallet credita payout
 *   4. Wallet → wallet.credit.done  → Game confirma crédito (log)
 *
 * Fluxo de crash (apostas perdidas não geram crédito — saldo não muda):
 *   5. Game  → game.round.crashed   → Wallet registra perdas (auditoria)
 */

// ── Eventos do Game Service → Wallet Service ──────────────────────────────────

export const GameEvents = {
  BET_PLACED:    'game.bet.placed',
  BET_CASHOUT:   'game.bet.cashout',
  ROUND_CRASHED: 'game.round.crashed',
} as const;

export type GameEventKey = typeof GameEvents[keyof typeof GameEvents];

export interface BetPlacedEvent {
  eventId:   string;   // UUID único do evento (idempotência)
  betId:     string;
  roundId:   string;
  playerId:  string;
  amountCents: string; // BigInt serializado como string
  placedAt:  string;   // ISO 8601
}

export interface BetCashoutEvent {
  eventId:      string;
  betId:        string;
  roundId:      string;
  playerId:     string;
  payoutCents:  string; // BigInt serializado como string
  multiplier:   number;
  cashedOutAt:  string;
}

export interface RoundCrashedEvent {
  eventId:    string;
  roundId:    string;
  crashPoint: number;
  loserBetIds: string[];
  crashedAt:  string;
}

// ── Eventos do Wallet Service → Game Service ──────────────────────────────────

export const WalletEvents = {
  DEBIT_APPROVED: 'wallet.debit.approved',
  DEBIT_REJECTED: 'wallet.debit.rejected',
  CREDIT_DONE:    'wallet.credit.done',
} as const;

export type WalletEventKey = typeof WalletEvents[keyof typeof WalletEvents];

export interface DebitApprovedEvent {
  eventId:     string;
  betId:       string;
  playerId:    string;
  amountCents: string;
  approvedAt:  string;
}

export interface DebitRejectedEvent {
  eventId:    string;
  betId:      string;
  playerId:   string;
  reason:     'INSUFFICIENT_FUNDS' | 'WALLET_NOT_FOUND';
  rejectedAt: string;
}

export interface CreditDoneEvent {
  eventId:     string;
  betId:       string;
  playerId:    string;
  payoutCents: string;
  doneAt:      string;
}

// ── Configuração de filas ─────────────────────────────────────────────────────

export const RABBITMQ_CONFIG = {
  EXCHANGE:      'crash.events',
  EXCHANGE_TYPE: 'topic' as const,
  QUEUES: {
    /** Wallet Service consome eventos do Game */
    WALLET_GAME_EVENTS:  'wallet.game-events',
    /** Game Service consome eventos do Wallet */
    GAME_WALLET_EVENTS:  'game.wallet-events',
  },
  BINDING_KEYS: {
    WALLET_GAME_EVENTS: 'game.*',
    GAME_WALLET_EVENTS: 'wallet.*',
  },
  /** Dead Letter Exchange para mensagens que falharam após retentativas */
  DLX: 'crash.dead-letter',
} as const;

// ── Helper para serializar BigInt ─────────────────────────────────────────────

export function serializeBigInt(value: bigint): string {
  return value.toString();
}

export function deserializeBigInt(value: string): bigint {
  return BigInt(value);
}
