import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';
import { JwtModule }       from '@nestjs/jwt';
import { ScheduleModule }  from '@nestjs/schedule';

import { GameController }      from './presentation/controllers/game.controller';
import { GameEventsGateway }   from './presentation/gateways/game-events.gateway';
import { GameEngineService }   from './application/game-engine.service';
import { PlaceBetUseCase }     from './application/use-cases/place-bet.use-case';
import { CashOutUseCase }      from './application/use-cases/cashout.use-case';
import {
  GetCurrentRoundUseCase,
  GetRoundHistoryUseCase,
  VerifyRoundUseCase,
  GetPlayerBetsUseCase,
} from './application/use-cases/query.use-cases';
import { ProvablyFairService } from './domain/services/provably-fair.service';
import { RoundRepositoryImpl } from './infrastructure/persistence/round.repository.impl';
import { RabbitMQModule }      from './infrastructure/messaging/rabbitmq.module';
import { OutboxPublisher }     from './infrastructure/messaging/outbox.publisher';
import { JwtAuthGuard }        from './infrastructure/auth/jwt-auth.guard';

@Module({
  imports: [
    // Banco de dados
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type:        'postgres',
        url:         process.env.DATABASE_URL,
        synchronize: false,        // nunca em prod — usamos migrations SQL
        logging:     process.env.NODE_ENV === 'development',
        ssl:         process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),

    // JWT (sem secret — usa JWKS do Keycloak)
    JwtModule.register({}),

    // Cron jobs (OutboxPoller)
    ScheduleModule.forRoot(),

    // RabbitMQ
    RabbitMQModule,
  ],

  controllers: [GameController],

  providers: [
    // WebSocket
    GameEventsGateway,

    // Application
    GameEngineService,
    PlaceBetUseCase,
    CashOutUseCase,
    GetCurrentRoundUseCase,
    GetRoundHistoryUseCase,
    VerifyRoundUseCase,
    GetPlayerBetsUseCase,

    // Domain Services
    ProvablyFairService,

    // Infrastructure
    { provide: 'IRoundRepository', useClass: RoundRepositoryImpl },
    OutboxPublisher,
    JwtAuthGuard,
  ],
})
export class AppModule {}
