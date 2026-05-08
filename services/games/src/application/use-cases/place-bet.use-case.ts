import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Bet } from '../../domain/bet/bet.entity';
import { Money } from '../../domain/value-objects/money.vo';
import { GameEngineService } from '../game-engine.service';
import { OutboxPublisher }   from '../../infrastructure/messaging/outbox.publisher';
import { GameEvents, serializeBigInt } from '@crash/events';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface PlaceBetDto {
  playerId:  string;
  username:  string;
  amountCents: bigint;
}

export interface PlaceBetResult {
  betId:       string;
  roundId:     string;
  amountCents: bigint;
  status:      string;
}

/**
 * Use Case: PlaceBet
 *
 * Fluxo:
 *  1. Valida o valor da aposta (Money VO garante min/max)
 *  2. Delega ao GameEngineService (que verifica estado da rodada)
 *  3. Persiste a aposta e o evento no outbox (mesma transação)
 *  4. O Outbox publica game.bet.placed → Wallet Service debita o saldo
 */
@Injectable()
export class PlaceBetUseCase {
  constructor(
    private readonly engine:  GameEngineService,
    private readonly outbox:  OutboxPublisher,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async execute(dto: PlaceBetDto): Promise<PlaceBetResult> {
    const amount = Money.fromCents(dto.amountCents);

    const bet = Bet.create({
      id:       randomUUID(),
      roundId:  this.engine.getCurrentRoundSnapshot()!.id,
      playerId: dto.playerId,
      username: dto.username,
      amount,
    });

    // Registra a aposta no engine (memória) — valida estado da rodada
    await this.engine.placeBet(bet);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Persiste a aposta no banco
      await queryRunner.query(
        `INSERT INTO bets (id, round_id, player_id, username, amount_cents, status, placed_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())`,
        [bet.id, bet.roundId, bet.playerId, bet.username, bet.amount.cents.toString()],
      );

      // Publica evento para o Wallet Service (débito assíncrono)
      await this.outbox.saveToOutbox(
        GameEvents.BET_PLACED,
        {
          eventId:     randomUUID(),
          betId:       bet.id,
          roundId:     bet.roundId,
          playerId:    bet.playerId,
          amountCents: serializeBigInt(bet.amount.cents),
          placedAt:    new Date().toISOString(),
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

    return {
      betId:       bet.id,
      roundId:     bet.roundId,
      amountCents: bet.amount.cents,
      status:      bet.status,
    };
  }
}
