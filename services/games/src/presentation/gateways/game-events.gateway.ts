import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * GameEventsGateway — WebSocket (socket.io)
 *
 * Responsável APENAS por emitir eventos do servidor para os clientes.
 * Todas as ações dos jogadores (apostar, sacar) acontecem via REST.
 *
 * Eventos emitidos (server → client):
 *
 *   round:new          Nova rodada iniciada, fase de apostas aberta
 *   round:betting-end  Fase de apostas encerrada, multiplicador vai subir
 *   multiplier:tick    Atualização do multiplicador (a cada 100ms)
 *   round:crashed      Rodada encerrada, crash point revelado
 *   bet:placed         Um jogador fez uma aposta (visível a todos)
 *   bet:cashout        Um jogador sacou (visível a todos)
 *
 * O gateway fica atrás do Kong (proxy WebSocket na porta 8000).
 * O frontend conecta via ws://localhost:8000/games/socket.io
 */
@WebSocketGateway({
  namespace:   '/games',
  cors:        { origin: '*' },  // em prod: restringir ao domínio do frontend
  transports:  ['websocket', 'polling'],
})
export class GameEventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(GameEventsGateway.name);
  private connectedClients = 0;

  onGatewayInit(server: Server): void {
    this.logger.log('WebSocket Gateway inicializado');
  }

  handleConnection(client: Socket): void {
    this.connectedClients++;
    this.logger.debug(`Cliente conectado: ${client.id} | total: ${this.connectedClients}`);
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients--;
    this.logger.debug(`Cliente desconectado: ${client.id} | total: ${this.connectedClients}`);
  }

  // ── Emissores de eventos ──────────────────────────────────────────────────

  /**
   * Emitido quando uma nova rodada começa (fase de apostas aberta).
   * O frontend deve:
   *  - Exibir a hash da seed (prova de fairness antes das apostas)
   *  - Habilitar o botão de aposta
   *  - Iniciar o timer de contagem regressiva
   */
  emitRoundNew(payload: RoundNewPayload): void {
    this.server.emit('round:new', payload);
    this.logger.debug(`round:new emitido: ${payload.roundId}`);
  }

  /**
   * Emitido quando a janela de apostas fecha.
   * O frontend deve desabilitar o botão de aposta imediatamente.
   */
  emitBettingEnd(payload: BettingEndPayload): void {
    this.server.emit('round:betting-end', payload);
  }

  /**
   * Emitido a cada 100ms durante a fase RUNNING.
   * O frontend usa este evento para animar a curva do multiplicador.
   *
   * Estratégia de sincronização:
   *  - O cliente recebe o multiplier exato do servidor (sem interpolar no cliente)
   *  - Isso garante que todas as abas mostrem o mesmo valor simultaneamente
   *  - O elapsedMs permite ao cliente recalcular o multiplicador localmente
   *    caso perca alguns ticks (resiliência a drops de conexão)
   */
  emitMultiplierTick(payload: MultiplierTickPayload): void {
    this.server.emit('multiplier:tick', payload);
  }

  /**
   * Emitido quando a rodada crasha.
   * O frontend deve:
   *  - Parar a animação do multiplicador
   *  - Exibir o crash point com destaque visual
   *  - Revelar o serverSeed para verificação pelo jogador
   *  - Marcar apostas pendentes como perdidas
   */
  emitRoundCrashed(payload: RoundCrashedPayload): void {
    this.server.emit('round:crashed', payload);
    this.logger.log(`round:crashed emitido: ${payload.roundId} @ ${payload.crashPoint}x`);
  }

  /**
   * Emitido quando um jogador faz uma aposta.
   * Todos os clientes veem as apostas dos outros em tempo real.
   */
  emitBetPlaced(payload: BetPlacedPayload): void {
    this.server.emit('bet:placed', payload);
  }

  /**
   * Emitido quando um jogador saca.
   * O frontend destaca o cashout na lista de apostas.
   */
  emitBetCashout(payload: BetCashoutPayload): void {
    this.server.emit('bet:cashout', payload);
    this.logger.debug(`bet:cashout: ${payload.username} @ ${payload.multiplier}x`);
  }

  getConnectedClients(): number {
    return this.connectedClients;
  }
}

// ── Tipos dos payloads WebSocket ──────────────────────────────────────────────

export interface RoundNewPayload {
  roundId:           string;
  serverSeedHash:    string;    // publicado antes das apostas (fairness)
  bettingEndsAt:     string;    // ISO 8601 — frontend usa para o countdown
  bettingDurationMs: number;
}

export interface BettingEndPayload {
  roundId: string;
}

export interface MultiplierTickPayload {
  roundId:    string;
  multiplier: number;  // ex: 2.48
  elapsedMs:  number;  // ms desde o início da rodada
}

export interface RoundCrashedPayload {
  roundId:        string;
  crashPoint:     number;   // multiplicador final
  serverSeed:     string;   // revelado após o crash (verificação provably fair)
  serverSeedHash: string;   // para o frontend confirmar que bate com o hash anterior
}

export interface BetPlacedPayload {
  roundId:     string;
  betId:       string;
  playerId:    string;
  username:    string;
  amountCents: string;  // BigInt como string
}

export interface BetCashoutPayload {
  roundId:     string;
  betId:       string;
  playerId:    string;
  username:    string;
  multiplier:  number;
  payoutCents: string;  // BigInt como string
}
