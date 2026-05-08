import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RABBITMQ_CONFIG } from '@crash/events';

/**
 * OutboxPublisher — Wallet Service
 *
 * Idêntico ao do Game Service — publica eventos do outbox no RabbitMQ.
 * Mantido separado para respeitar a independência dos bounded contexts.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

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
          row.event_type,
          row.payload,
          { persistent: true, messageId: row.id, contentType: 'application/json' },
        );

        await this.dataSource.query(
          `UPDATE outbox SET published = TRUE, published_at = NOW() WHERE id = $1`,
          [row.id],
        );

        this.logger.debug(`Evento publicado: ${row.event_type} [${row.id}]`);
      } catch (err) {
        this.logger.error(`Falha ao publicar ${row.event_type} [${row.id}]:`, err);
      }
    }
  }
}

interface OutboxRow {
  id:         string;
  event_type: string;
  payload:    Record<string, unknown>;
}
