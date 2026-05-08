import { NestFactory }           from '@nestjs/core';
import { ValidationPipe }        from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter }             from '@nestjs/platform-socket.io';
import { AppModule }             from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Prefixo global dos endpoints REST
  app.setGlobalPrefix('games');

  // Validação automática dos DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist:        true,
    forbidNonWhitelisted: true,
    transform:        true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Adapter do socket.io para WebSocket
  app.useWebSocketAdapter(new IoAdapter(app));

  // CORS — em prod, restringir ao domínio do frontend
  app.enableCors({ origin: '*' });

  // Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('Crash Game — Game Service')
    .setDescription('Engine do jogo, apostas, cashout, histórico e verificação provably fair')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('http://localhost:8000', 'Via Kong (API Gateway)')
    .addServer('http://localhost:4001', 'Direto (dev)')
    .build();

  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('games/docs', app, doc);

  const port = process.env.PORT ?? 4001;
  await app.listen(port);

  console.log(`🎮 Game Service rodando em: http://localhost:${port}`);
  console.log(`📖 Swagger em: http://localhost:${port}/games/docs`);
}

bootstrap();
