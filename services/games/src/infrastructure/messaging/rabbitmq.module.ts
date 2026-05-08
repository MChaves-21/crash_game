import { Module } from '@nestjs/common';
import { RabbitMQModule as GolevelupRabbitMQ } from '@golevelup/nestjs-rabbitmq';
import { RABBITMQ_CONFIG } from '@crash/events';
import { OutboxPublisher }  from './outbox.publisher';
import { OutboxPoller }     from './outbox.poller';
import { WalletEventsConsumer } from './wallet-events.consumer';

/**
 * RabbitMQ Module — Game Service
 *
 * Configura:
 *  - Exchange topic: crash.events
 *  - Fila: game.wallet-events (consome respostas do Wallet Service)
 *  - Dead Letter Exchange para mensagens que falharam
 *  - OutboxPoller: publica mensagens persistidas no outbox
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
            name:    RABBITMQ_CONFIG.QUEUES.GAME_WALLET_EVENTS,
            options: {
              durable:   true,
              arguments: {
                'x-dead-letter-exchange': RABBITMQ_CONFIG.DLX,
                'x-message-ttl':          30_000,  // 30s antes de ir para DLX
              },
            },
            bindingOptions: {
              exchange:   RABBITMQ_CONFIG.EXCHANGE,
              routingKey: RABBITMQ_CONFIG.BINDING_KEYS.GAME_WALLET_EVENTS,
            },
          },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        // Prefetch: processa 1 mensagem por vez para garantir ordem
        channels: {
          'game-channel': { prefetchCount: 1, default: true },
        },
      }),
    }),
  ],
  providers: [
    OutboxPublisher,
    OutboxPoller,
    WalletEventsConsumer,
  ],
  exports: [OutboxPublisher],
})
export class RabbitMQModule {}
