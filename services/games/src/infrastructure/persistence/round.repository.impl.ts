import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Round, RoundProps } from '../../domain/round/round.aggregate';
import { Bet, BetProps }     from '../../domain/bet/bet.entity';
import { Money }             from '../../domain/value-objects/money.vo';
import { Multiplier }        from '../../domain/value-objects/multiplier.vo';
import {
  IRoundRepository,
  PaginationParams,
  PaginatedResult,
} from '../../domain/round/round.repository';

/**
 * RoundRepositoryImpl
 *
 * Implementação concreta do IRoundRepository usando TypeORM + PostgreSQL.
 * A camada de domínio nunca conhece esta classe — só conhece a interface.
 */
@Injectable()
export class RoundRepositoryImpl implements IRoundRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async save(round: Round): Promise<void> {
    const s = round.toInternalSnapshot();
    await this.dataSource.query(
      `INSERT INTO rounds
         (id, status, server_seed, server_seed_hash, crash_point,
          current_multiplier, betting_ends_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        s.id, s.status, s.serverSeed, s.serverSeedHash,
        s.crashPoint, s.currentMultiplier,
        s.bettingEndsAt, s.createdAt,
      ],
    );

    // Persiste as apostas iniciais (geralmente vazio na criação)
    for (const bet of s.bets.values()) {
      await this.saveBet(bet.toSnapshot());
    }
  }

  async update(round: Round): Promise<void> {
    const s = round.toInternalSnapshot();
    await this.dataSource.query(
      `UPDATE rounds
       SET status = $1, current_multiplier = $2,
           started_at = $3, crashed_at = $4
       WHERE id = $5`,
      [s.status, s.currentMultiplier, s.startedAt ?? null, s.crashedAt ?? null, s.id],
    );
  }

  async findById(id: string): Promise<Round | null> {
    const [row] = await this.dataSource.query<RoundRow[]>(
      `SELECT * FROM rounds WHERE id = $1`, [id],
    );
    if (!row) return null;

    const bets = await this.findBetsByRoundId(id);
    return this.hydrate(row, bets);
  }

  async findCurrent(): Promise<Round | null> {
    const [row] = await this.dataSource.query<RoundRow[]>(
      `SELECT * FROM rounds
       WHERE status IN ('BETTING','RUNNING')
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (!row) return null;

    const bets = await this.findBetsByRoundId(row.id);
    return this.hydrate(row, bets);
  }

  async findHistory(params: PaginationParams): Promise<PaginatedResult<Round>> {
    const offset = (params.page - 1) * params.limit;
    const [rows, [{ count }]] = await Promise.all([
      this.dataSource.query<RoundRow[]>(
        `SELECT * FROM rounds WHERE status='CRASHED'
         ORDER BY crashed_at DESC LIMIT $1 OFFSET $2`,
        [params.limit, offset],
      ),
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*) as count FROM rounds WHERE status='CRASHED'`,
      ),
    ]);

    const total = parseInt(count, 10);
    const data  = await Promise.all(
      rows.map(async r => this.hydrate(r, await this.findBetsByRoundId(r.id))),
    );

    return { data, total, page: params.page, limit: params.limit,
             totalPages: Math.ceil(total / params.limit) };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async findBetsByRoundId(roundId: string): Promise<BetRow[]> {
    return this.dataSource.query<BetRow[]>(
      `SELECT * FROM bets WHERE round_id = $1`, [roundId],
    );
  }

  private async saveBet(bet: BetProps): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO bets
         (id, round_id, player_id, username, amount_cents, status, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [bet.id, bet.roundId, bet.playerId, bet.username,
       bet.amount.cents.toString(), bet.status, bet.placedAt],
    );
  }

  private hydrate(row: RoundRow, betRows: BetRow[]): Round {
    const betsMap = new Map<string, Bet>();
    for (const b of betRows) {
      const bet = Bet.reconstitute({
        id:           b.id,
        roundId:      b.round_id,
        playerId:     b.player_id,
        username:     b.username,
        amount:       Money.fromCents(BigInt(b.amount_cents)),
        status:       b.status as any,
        cashoutAt:    b.cashout_at_multiplier
          ? Multiplier.of(parseFloat(b.cashout_at_multiplier))
          : undefined,
        payout:       b.payout_cents
          ? Money.fromCents(BigInt(b.payout_cents))
          : undefined,
        placedAt:     new Date(b.placed_at),
        cashedOutAt:  b.cashed_out_at ? new Date(b.cashed_out_at) : undefined,
      });
      betsMap.set(bet.playerId, bet);
    }

    const props: RoundProps = {
      id:                row.id,
      status:            row.status as any,
      serverSeed:        row.server_seed,
      serverSeedHash:    row.server_seed_hash,
      crashPoint:        parseFloat(row.crash_point),
      currentMultiplier: parseFloat(row.current_multiplier),
      bets:              betsMap,
      bettingEndsAt:     new Date(row.betting_ends_at),
      startedAt:         row.started_at  ? new Date(row.started_at)  : undefined,
      crashedAt:         row.crashed_at  ? new Date(row.crashed_at)  : undefined,
      createdAt:         new Date(row.created_at),
    };
    return Round.reconstitute(props);
  }
}

// ── Tipos de linha do banco ───────────────────────────────────────────────────

interface RoundRow {
  id:                string;
  status:            string;
  server_seed:       string;
  server_seed_hash:  string;
  crash_point:       string;
  current_multiplier: string;
  betting_ends_at:   string;
  started_at:        string | null;
  crashed_at:        string | null;
  created_at:        string;
}

interface BetRow {
  id:                    string;
  round_id:              string;
  player_id:             string;
  username:              string;
  amount_cents:          string;
  status:                string;
  cashout_at_multiplier: string | null;
  payout_cents:          string | null;
  placed_at:             string;
  cashed_out_at:         string | null;
}
