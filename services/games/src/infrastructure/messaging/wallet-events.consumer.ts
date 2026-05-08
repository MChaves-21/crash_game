import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  WalletEvents,
  DebitApprovedEvent,
  DebitRejectedEvent,
  RABBITMQ_CONFIG,
} from '@crash/events';

/**
 * WalletEventsConsumer — Game Service
 *
 * Consome respostas do Wallet Service:
 *  - wallet.debit.approved → aposta confirmada (já debitada)
 *  - wallet.debit.rejected → aposta cancelada (saldo insuficiente)
 *
 * Padrão Inbox: verifica idempotência antes de processar qualquer evento.
 * Se o eventId já está na tabela inbox → descarta silenciosamente (ACK).
 */
@Injectable()
export class WalletEventsConsumer {
  private readonly logger = new Logger(WalletEventsConsumer.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @RabbitSubscribe({
    exchange:   RABBITMQ_CONFIG.EXCHANGE,
    routingKey: WalletEvents.DEBIT_APPROVED,
    queue:      RABBITMQ_CONFIG.QUEUES.GAME_WALLET_EVENTS,
  })
  async onDebitApproved(event: DebitApprovedEvent): Promise<void | Nack> {
    const alreadyProcessed = await this.markInboxOrSkip(event.eventId, WalletEvents.DEBIT_APPROVED);
    if (alreadyProcessed) return;

    this.logger.log(
      `Débito aprovado: betId=${event.betId} playerId=${event.playerId}`,
    );

    // A aposta já foi registrada no momento do POST /games/bet.
    // O evento de aprovação serve para logging/auditoria e para casos
    // onde o Game Service precise de confirmação explícita do débito.
    // Em arquiteturas mais complexas, a aposta ficaria em status PENDING_DEBIT
    // até receber este evento.

    await this.dataSource.query(
      `UPDATE inbox SET processed = TRUE, processed_at = NOW() WHERE event_id = $1`,
      [event.eventId],
    );
  }

  @RabbitSubscribe({
    exchange:   RABBITMQ_CONFIG.EXCHANGE,
    routingKey: WalletEvents.DEBIT_REJECTED,
    queue:      RABBITMQ_CONFIG.QUEUES.GAME_WALLET_EVENTS,
  })
  async onDebitRejected(event: DebitRejectedEvent): Promise<void | Nack> {
    const alreadyProcessed = await this.markInboxOrSkip(event.eventId, WalletEvents.DEBIT_REJECTED);
    if (alreadyProcessed) return;

    this.logger.warn(
      `Débito rejeitado: betId=${event.betId} reason=${event.reason}`,
    );

    // Cancela a aposta — muda status para LOST com motivo de rejeição
    await this.dataSource.query(
      `UPDATE bets SET status = 'LOST' WHERE id = $1`,
      [event.betId],
    );

    await this.dataSource.query(
      `UPDATE inbox SET processed = TRUE, processed_at = NOW() WHERE event_id = $1`,
      [event.eventId],
    );
  }

  /**
   * Registra o evento no inbox e retorna true se já foi processado antes.
   * Garante exactly-once processing.
   */
  private async markInboxOrSkip(eventId: string, eventType: string): Promise<boolean> {
    try {
      await this.dataSource.query(
        `INSERT INTO inbox (event_id, event_type) VALUES ($1, $2)`,
        [eventId, eventType],
      );
      return false; // Novo evento — processar
    } catch {
      // Violação de PRIMARY KEY → evento duplicado → descartar
      this.logger.warn(`Evento duplicado ignorado: ${eventId}`);
      return true;
    }
  }
}
