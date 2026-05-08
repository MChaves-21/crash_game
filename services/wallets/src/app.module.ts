import { Module }         from '@nestjs/common';
import { TypeOrmModule }  from '@nestjs/typeorm';
import { JwtModule }      from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';

import { WalletController }          from './presentation/controllers/wallet.controller';
import {
  CreateWalletUseCase,
  GetMyWalletUseCase,
  GetTransactionHistoryUseCase,
}                                    from './application/use-cases/wallet.use-cases';
import { WalletRepositoryImpl }      from './infrastructure/persistence/wallet.repository.impl';
import { RabbitMQModule }            from './infrastructure/messaging/rabbitmq.module';
import { OutboxPublisher }           from './infrastructure/messaging/outbox.publisher';
import { JwtAuthGuard }              from './infrastructure/auth/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type:        'postgres',
        url:         process.env.DATABASE_URL,
        synchronize: false,
        logging:     process.env.NODE_ENV === 'development',
        ssl:         process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),

    JwtModule.register({}),
    ScheduleModule.forRoot(),
    RabbitMQModule,
  ],

  controllers: [WalletController],

  providers: [
    // Application
    CreateWalletUseCase,
    GetMyWalletUseCase,
    GetTransactionHistoryUseCase,

    // Infrastructure
    { provide: 'IWalletRepository', useClass: WalletRepositoryImpl },
    OutboxPublisher,
    JwtAuthGuard,
  ],
})
export class AppModule {}
