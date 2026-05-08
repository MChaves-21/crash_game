import { Module } from '@nestjs/common';
import { RabbitMQModule as GolevelupRabbitMQ } from '@golevelup/nestjs-rabbitmq';
import { RABBITMQ_CONFIG } from '@crash/events';
import { OutboxPublisher }    from './outbox.publisher';
import { OutboxPoller }       from './outbox.poller';
import { GameEventsConsumer } from './game-events.consumer';

/**
 * RabbitMQ Module — Wallet Service
 *
 * Configura:
 *  - Exchange topic: crash.events
 *  - Fila: wallet.game-events (consome eventos do Game Service)
 *  - Dead Letter Exchange para mensagens que falharam
 */
@Module({
  imports: [
    GolevelupRabbitMQ.forRootAsync(GolevelupRabbitMQ.name, {
      useFactory: () => ({
        uri: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
        exchanges: [
          {
            name:    RABBITMQ_CONFIG.EXCHANGE,
            type:    RABBITMQ_CONFIG.EXCHANGE_TYPE,
            options: { durable: true },
          },
          {
            name:    RABBITMQ_CONFIG.DLX,
            type:    'fanout',
            options: { durable: true },
          },
        ],
        queues: [
          {
            name: RABBITMQ_CONFIG.QUEUES.WALLET_GAME_EVENTS,
            options: {
              durable:   true,
              arguments: {
                'x-dead-letter-exchange': RABBITMQ_CONFIG.DLX,
                'x-message-ttl':          30_000,
              },
            },
            bindingOptions: {
              exchange:   RABBITMQ_CONFIG.EXCHANGE,
              routingKey: RABBITMQ_CONFIG.BINDING_KEYS.WALLET_GAME_EVENTS,
            },
          },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        channels: {
          'wallet-channel': { prefetchCount: 1, default: true },
        },
      }),
    }),
  ],
  providers: [OutboxPublisher, OutboxPoller, GameEventsConsumer],
  exports:   [OutboxPublisher],
})
export class RabbitMQModule {}
