import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RABBITMQ_CONFIG } from '@crash/events';

/**
 * OutboxPublisher
 *
 * Responsável por ler mensagens da tabela outbox e publicá-las no RabbitMQ.
 * Garante at-least-once delivery: mesmo que o processo caia após persistir
 * mas antes de publicar, o OutboxPoller vai retentar.
 *
 * Idempotência no consumidor é garantida pela tabela inbox do outro serviço.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Persiste o evento no outbox DENTRO da mesma transação de negócio.
   * Deve ser chamado antes do commit da transação principal.
   */
  async saveToOutbox(
    eventType: string,
    payload: Record<string, unknown>,
    queryRunner: import('typeorm').QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO outbox (event_type, payload) VALUES ($1, $2)`,
      [eventType, JSON.stringify(payload)],
    );
  }

  /**
   * Lê mensagens não publicadas do outbox e as envia para o RabbitMQ.
   * Chamado pelo OutboxPoller em intervalos regulares.
   */
  async publishPending(): Promise<void> {
    const rows = await this.dataSource.query<OutboxRow[]>(
      `SELECT id, event_type, payload
       FROM outbox
       WHERE published = FALSE
       ORDER BY created_at ASC
       LIMIT 50`,
    );

    for (const row of rows) {
      try {
        await this.amqp.publish(
          RABBITMQ_CONFIG.EXCHANGE,
          row.event_type,        // routing key = event type (ex: 'game.bet.placed')
          row.payload,
          {
            persistent:    true, // sobrevive a restart do broker
            messageId:     row.id,
            contentType:   'application/json',
          },
        );

        await this.dataSource.query(
          `UPDATE outbox
           SET published = TRUE, published_at = NOW()
           WHERE id = $1`,
          [row.id],
        );

        this.logger.debug(`Evento publicado: ${row.event_type} [${row.id}]`);
      } catch (err) {
        this.logger.error(
          `Falha ao publicar evento ${row.event_type} [${row.id}]:`,
          err,
        );
        // Não relança — deixa para a próxima execução do poller
      }
    }
  }
}

interface OutboxRow {
  id:         string;
  event_type: string;
  payload:    Record<string, unknown>;
}
