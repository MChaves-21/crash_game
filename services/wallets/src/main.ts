import { NestFactory }    from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }      from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  app.setGlobalPrefix('wallets');

  app.useGlobalPipes(new ValidationPipe({
    whitelist:        true,
    forbidNonWhitelisted: true,
    transform:        true,
    transformOptions: { enableImplicitConversion: true },
  }));

  app.enableCors({ origin: '*' });

  const config = new DocumentBuilder()
    .setTitle('Crash Game — Wallet Service')
    .setDescription('Carteira do jogador: saldo, crédito e débito via mensageria')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('http://localhost:8000', 'Via Kong (API Gateway)')
    .addServer('http://localhost:4002', 'Direto (dev)')
    .build();

  SwaggerModule.setup('wallets/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 4002;
  await app.listen(port);

  console.log(`💰 Wallet Service rodando em: http://localhost:${port}`);
  console.log(`📖 Swagger em: http://localhost:${port}/wallets/docs`);
}

bootstrap();
