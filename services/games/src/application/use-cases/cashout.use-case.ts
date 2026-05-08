import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GameEngineService } from '../game-engine.service';
import { OutboxPublisher }   from '../../infrastructure/messaging/outbox.publisher';
import { GameEvents, serializeBigInt } from '@crash/events';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface CashOutDto {
  playerId: string;
}

export interface CashOutResult {
  betId:       string;
  multiplier:  number;
  payoutCents: bigint;
}

/**
 * Use Case: CashOut
 *
 * Fluxo:
 *  1. Delega ao GameEngineService (verifica estado RUNNING + aposta existente)
 *  2. Persiste o cashout no banco e no outbox (mesma transação)
 *  3. O Outbox publica game.bet.cashout → Wallet Service credita o payout
 */
@Injectable()
export class CashOutUseCase {
  constructor(
    private readonly engine: GameEngineService,
    private readonly outbox: OutboxPublisher,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async execute(dto: CashOutDto): Promise<CashOutResult> {
    // Executa o cashout no engine (memória) — captura payout no multiplicador atual
    const { payout, multiplier } = await this.engine.cashOut(dto.playerId);

    const snapshot = this.engine.getCurrentRoundSnapshot()!;

    // Busca o betId do jogador na rodada atual
    const [betRow] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM bets WHERE player_id = $1 AND round_id = $2`,
      [dto.playerId, snapshot.id],
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Atualiza a aposta com status CASHED_OUT e o payout
      await queryRunner.query(
        `UPDATE bets
         SET status = 'CASHED_OUT',
             cashout_at_multiplier = $1,
             payout_cents          = $2,
             cashed_out_at         = NOW()
         WHERE id = $3`,
        [multiplier, payout.cents.toString(), betRow.id],
      );

      // Publica evento para o Wallet Service (crédito assíncrono)
      await this.outbox.saveToOutbox(
        GameEvents.BET_CASHOUT,
        {
          eventId:     randomUUID(),
          betId:       betRow.id,
          roundId:     snapshot.id,
          playerId:    dto.playerId,
          payoutCents: serializeBigInt(payout.cents),
          multiplier,
          cashedOutAt: new Date().toISOString(),
        },
        queryRunner,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return { betId: betRow.id, multiplier, payoutCents: payout.cents };
  }
}
