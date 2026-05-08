import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GameEngineService } from '../game-engine.service';
import { ProvablyFairService } from '../../domain/services/provably-fair.service';

/**
 * Use Case: GetCurrentRound
 * Retorna o estado atual da rodada (do engine em memória).
 */
@Injectable()
export class GetCurrentRoundUseCase {
  constructor(private readonly engine: GameEngineService) {}

  execute() {
    return this.engine.getCurrentRoundSnapshot();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use Case: GetRoundHistory
 * Retorna histórico paginado de rodadas finalizadas.
 */
@Injectable()
export class GetRoundHistoryUseCase {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const safeLimit = Math.min(limit, 100);

    const [rows, [{ count }]] = await Promise.all([
      this.dataSource.query<RoundRow[]>(
        `SELECT
           id, status, server_seed, server_seed_hash,
           crash_point, crashed_at, betting_ends_at,
           started_at, created_at
         FROM rounds
         WHERE status = 'CRASHED'
         ORDER BY crashed_at DESC
         LIMIT $1 OFFSET $2`,
        [safeLimit, offset],
      ),
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*) as count FROM rounds WHERE status = 'CRASHED'`,
      ),
    ]);

    const total = parseInt(count, 10);

    return {
      data: rows.map(r => ({
        id:             r.id,
        crashPoint:     parseFloat(r.crash_point),
        serverSeed:     r.server_seed,
        serverSeedHash: r.server_seed_hash,
        crashedAt:      r.crashed_at,
        startedAt:      r.started_at,
        createdAt:      r.created_at,
      })),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use Case: VerifyRound
 * Retorna os dados de verificação provably fair de uma rodada finalizada.
 * Permite ao jogador confirmar que o crash point foi pré-determinado.
 */
@Injectable()
export class VerifyRoundUseCase {
  constructor(
    private readonly provablyFair: ProvablyFairService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async execute(roundId: string) {
    const [round] = await this.dataSource.query<RoundRow[]>(
      `SELECT id, server_seed, server_seed_hash, crash_point, status
       FROM rounds WHERE id = $1`,
      [roundId],
    );

    if (!round) return null;
    if (round.status !== 'CRASHED') {
      return { message: 'A rodada ainda não foi finalizada — seed não revelada' };
    }

    const result = this.provablyFair.verify(
      round.server_seed,
      round.id,
      parseFloat(round.crash_point),
    );

    return {
      roundId:        round.id,
      serverSeed:     round.server_seed,
      serverSeedHash: round.server_seed_hash,
      crashPoint:     parseFloat(round.crash_point),
      verification:   result,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use Case: GetPlayerBets
 * Retorna histórico paginado de apostas de um jogador específico.
 */
@Injectable()
export class GetPlayerBetsUseCase {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(playerId: string, page = 1, limit = 20) {
    const offset    = (page - 1) * limit;
    const safeLimit = Math.min(limit, 100);

    const [rows, [{ count }]] = await Promise.all([
      this.dataSource.query<BetRow[]>(
        `SELECT
           b.id, b.round_id, b.amount_cents, b.status,
           b.cashout_at_multiplier, b.payout_cents,
           b.placed_at, b.cashed_out_at,
           r.crash_point, r.crashed_at
         FROM bets b
         JOIN rounds r ON r.id = b.round_id
         WHERE b.player_id = $1
         ORDER BY b.placed_at DESC
         LIMIT $2 OFFSET $3`,
        [playerId, safeLimit, offset],
      ),
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*) as count FROM bets WHERE player_id = $1`,
        [playerId],
      ),
    ]);

    const total = parseInt(count, 10);

    return {
      data: rows.map(r => ({
        id:                  r.id,
        roundId:             r.round_id,
        amountCents:         r.amount_cents,
        status:              r.status,
        cashoutAtMultiplier: r.cashout_at_multiplier
          ? parseFloat(r.cashout_at_multiplier)
          : null,
        payoutCents:  r.payout_cents ?? null,
        placedAt:     r.placed_at,
        cashedOutAt:  r.cashed_out_at ?? null,
        roundCrashPoint: r.crash_point ? parseFloat(r.crash_point) : null,
        roundCrashedAt:  r.crashed_at ?? null,
      })),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }
}

// ── Tipos internos ────────────────────────────────────────────────────────────

interface RoundRow {
  id:              string;
  status:          string;
  server_seed:     string;
  server_seed_hash: string;
  crash_point:     string;
  crashed_at:      string;
  betting_ends_at: string;
  started_at:      string;
  created_at:      string;
}

interface BetRow {
  id:                    string;
  round_id:              string;
  amount_cents:          string;
  status:                string;
  cashout_at_multiplier: string | null;
  payout_cents:          string | null;
  placed_at:             string;
  cashed_out_at:         string | null;
  crash_point:           string | null;
  crashed_at:            string | null;
}
