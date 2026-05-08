import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  GameEvents,
  BetPlacedEvent,
  BetCashoutEvent,
  WalletEvents,
  RABBITMQ_CONFIG,
  deserializeBigInt,
} from '@crash/events';
import { Money } from '../../domain/value-objects/money.vo';
import { OutboxPublisher } from '../messaging/outbox.publisher';

/**
 * GameEventsConsumer — Wallet Service
 *
 * Consome eventos do Game Service:
 *  - game.bet.placed  → debita saldo do jogador
 *  - game.bet.cashout → credita payout do jogador
 *
 * Padrão Inbox + Outbox:
 *  - Inbox: garante idempotência (evento duplicado é descartado)
 *  - Outbox: persiste resposta junto com a transação financeira
 *
 * Toda operação de saldo acontece em uma única transação de banco:
 *  BEGIN → [inbox check] → [wallet update] → [transaction insert] → [outbox insert] → COMMIT
 */
@Injectable()
export class GameEventsConsumer {
  private readonly logger = new Logger(GameEventsConsumer.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outboxPublisher: OutboxPublisher,
  ) {}

  @RabbitSubscribe({
    exchange:   RABBITMQ_CONFIG.EXCHANGE,
    routingKey: GameEvents.BET_PLACED,
    queue:      RABBITMQ_CONFIG.QUEUES.WALLET_GAME_EVENTS,
  })
  async onBetPlaced(event: BetPlacedEvent): Promise<void | Nack> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Idempotência: verificar inbox
      const isNew = await this.insertInbox(queryRunner, event.eventId, GameEvents.BET_PLACED);
      if (!isNew) return;

      // 2. Buscar carteira com lock para evitar race conditions
      const [wallet] = await queryRunner.query<WalletRow[]>(
        `SELECT id, balance_cents FROM wallets WHERE player_id = $1 FOR UPDATE`,
        [event.playerId],
      );

      if (!wallet) {
        await this.publishRejection(queryRunner, event, 'WALLET_NOT_FOUND');
        await queryRunner.commitTransaction();
        return;
      }

      const amount        = Money.fromCents(deserializeBigInt(event.amountCents));
      const currentBalance = Money.fromCents(BigInt(wallet.balance_cents));

      // 3. Verificar saldo
      if (!currentBalance.isGreaterThanOrEq(amount)) {
        await this.publishRejection(queryRunner, event, 'INSUFFICIENT_FUNDS');
        await queryRunner.commitTransaction();
        return;
      }

      // 4. Debitar saldo
      const newBalance = currentBalance.subtract(amount);
      await queryRunner.query(
        `UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE id = $2`,
        [newBalance.cents.toString(), wallet.id],
      );

      // 5. Registrar transação (histórico imutável)
      await queryRunner.query(
        `INSERT INTO transactions (wallet_id, player_id, type, amount_cents, balance_after_cents, reference_id, description)
         VALUES ($1, $2, 'DEBIT', $3, $4, $5, $6)`,
        [
          wallet.id,
          event.playerId,
          amount.cents.toString(),
          newBalance.cents.toString(),
          event.betId,
          `Aposta na rodada ${event.roundId}`,
        ],
      );

      // 6. Publicar confirmação via outbox (atômico com a transação)
      const { randomUUID } = await import('crypto');
      await this.outboxPublisher.saveToOutbox(
        WalletEvents.DEBIT_APPROVED,
        {
          eventId:     randomUUID(),
          betId:       event.betId,
          playerId:    event.playerId,
          amountCents: event.amountCents,
          approvedAt:  new Date().toISOString(),
        },
        queryRunner,
      );

      await this.markInboxProcessed(queryRunner, event.eventId);
      await queryRunner.commitTransaction();

      this.logger.log(`Débito aprovado: ${amount} para player ${event.playerId}`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Erro ao processar bet.placed ${event.betId}:`, err);
      return new Nack(true); // Requeue para retentar
    } finally {
      await queryRunner.release();
    }
  }

  @RabbitSubscribe({
    exchange:   RABBITMQ_CONFIG.EXCHANGE,
    routingKey: GameEvents.BET_CASHOUT,
    queue:      RABBITMQ_CONFIG.QUEUES.WALLET_GAME_EVENTS,
  })
  async onBetCashout(event: BetCashoutEvent): Promise<void | Nack> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const isNew = await this.insertInbox(queryRunner, event.eventId, GameEvents.BET_CASHOUT);
      if (!isNew) return;

      const [wallet] = await queryRunner.query<WalletRow[]>(
        `SELECT id, balance_cents FROM wallets WHERE player_id = $1 FOR UPDATE`,
        [event.playerId],
      );

      if (!wallet) {
        this.logger.error(`Carteira não encontrada para cashout: player=${event.playerId}`);
        await queryRunner.rollbackTransaction();
        return new Nack(false); // Não requeue — dado inválido
      }

      const payout      = Money.fromCents(deserializeBigInt(event.payoutCents));
      const newBalance  = Money.fromCents(BigInt(wallet.balance_cents)).add(payout);

      await queryRunner.query(
        `UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE id = $2`,
        [newBalance.cents.toString(), wallet.id],
      );

      await queryRunner.query(
        `INSERT INTO transactions (wallet_id, player_id, type, amount_cents, balance_after_cents, reference_id, description)
         VALUES ($1, $2, 'CREDIT', $3, $4, $5, $6)`,
        [
          wallet.id,
          event.playerId,
          payout.cents.toString(),
          newBalance.cents.toString(),
          `cashout-${event.betId}`,
          `Cashout na rodada ${event.roundId} (${event.multiplier}x)`,
        ],
      );

      const { randomUUID } = await import('crypto');
      await this.outboxPublisher.saveToOutbox(
        WalletEvents.CREDIT_DONE,
        {
          eventId:     randomUUID(),
          betId:       event.betId,
          playerId:    event.playerId,
          payoutCents: event.payoutCents,
          doneAt:      new Date().toISOString(),
        },
        queryRunner,
      );

      await this.markInboxProcessed(queryRunner, event.eventId);
      await queryRunner.commitTransaction();

      this.logger.log(`Cashout creditado: ${payout} para player ${event.playerId}`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Erro ao processar bet.cashout ${event.betId}:`, err);
      return new Nack(true);
    } finally {
      await queryRunner.release();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async insertInbox(
    qr: import('typeorm').QueryRunner,
    eventId: string,
    eventType: string,
  ): Promise<boolean> {
    try {
      await qr.query(
        `INSERT INTO inbox (event_id, event_type) VALUES ($1, $2)`,
        [eventId, eventType],
      );
      return true;
    } catch {
      this.logger.warn(`Evento duplicado ignorado: ${eventId}`);
      await qr.rollbackTransaction();
      return false;
    }
  }

  private async markInboxProcessed(
    qr: import('typeorm').QueryRunner,
    eventId: string,
  ): Promise<void> {
    await qr.query(
      `UPDATE inbox SET processed = TRUE, processed_at = NOW() WHERE event_id = $1`,
      [eventId],
    );
  }

  private async publishRejection(
    qr: import('typeorm').QueryRunner,
    event: BetPlacedEvent,
    reason: 'INSUFFICIENT_FUNDS' | 'WALLET_NOT_FOUND',
  ): Promise<void> {
    const { randomUUID } = await import('crypto');
    await this.outboxPublisher.saveToOutbox(
      WalletEvents.DEBIT_REJECTED,
      {
        eventId:    randomUUID(),
        betId:      event.betId,
        playerId:   event.playerId,
        reason,
        rejectedAt: new Date().toISOString(),
      },
      qr,
    );
  }
}

interface WalletRow {
  id:            string;
  balance_cents: string; // PostgreSQL retorna BIGINT como string no Node.js
}
