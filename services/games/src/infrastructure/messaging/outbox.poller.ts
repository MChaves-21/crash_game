import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxPublisher } from './outbox.publisher';

/**
 * OutboxPoller
 *
 * Scheduler que varre a tabela outbox a cada 1 segundo e publica
 * mensagens pendentes no RabbitMQ.
 *
 * Em produção, considere usar pg_notify (LISTEN/NOTIFY) para latência menor.
 */
@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);
  private running = false;

  constructor(private readonly publisher: OutboxPublisher) {}

  @Cron(CronExpression.EVERY_SECOND)
  async poll(): Promise<void> {
    // Evita execuções concorrentes caso o poller demore mais de 1s
    if (this.running) return;

    this.running = true;
    try {
      await this.publisher.publishPending();
    } catch (err) {
      this.logger.error('Erro no OutboxPoller:', err);
    } finally {
      this.running = false;
    }
  }
}
