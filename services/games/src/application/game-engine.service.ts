import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Round } from '../../domain/round/round.aggregate';
import { Bet }   from '../../domain/bet/bet.entity';
import { Money } from '../../domain/value-objects/money.vo';
import { ProvablyFairService } from '../../domain/services/provably-fair.service';
import { IRoundRepository }   from '../../domain/round/round.repository';
import { OutboxPublisher }    from '../../infrastructure/messaging/outbox.publisher';
import { GameEventsGateway }  from '../../presentation/gateways/game-events.gateway';
import { GameEvents, serializeBigInt } from '@crash/events';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * GameEngineService
 *
 * Coração do jogo. Responsável por:
 *  1. Iniciar uma nova rodada após cada ciclo
 *  2. Gerenciar o timer da fase de apostas
 *  3. Calcular e emitir o multiplicador a cada tick (100ms)
 *  4. Detectar e executar o crash quando o multiplicador atinge o crash point
 *  5. Emitir eventos WebSocket para todos os clientes conectados
 *  6. Publicar eventos de domínio via Outbox para o Wallet Service
 *
 * Fórmula do multiplicador:
 *   m(t) = e^(GROWTH_RATE × t)
 *   onde t é o tempo em ms desde o início da rodada.
 *   GROWTH_RATE = 0.00006 → m(10s) ≈ 1.82x, m(30s) ≈ 6.05x
 *
 * Esta fórmula produz uma curva exponencial suave,
 * idêntica ao comportamento visual esperado pelo frontend.
 */
@Injectable()
export class GameEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameEngineService.name);

  // Configuração
  private static readonly BETTING_DURATION_MS = 10_000; // 10s de fase de apostas
  private static readonly TICK_INTERVAL_MS    = 100;    // emite tick a cada 100ms
  private static readonly GROWTH_RATE         = 0.00006; // taxa de crescimento exponencial

  // Estado em memória (source of truth durante a rodada ativa)
  private currentRound: Round | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private bettingTimeout: ReturnType<typeof setTimeout> | null = null;
  private roundStartTime: number | null = null;

  constructor(
    private readonly provablyFair:  ProvablyFairService,
    private readonly roundRepo:     IRoundRepository,
    private readonly outbox:        OutboxPublisher,
    private readonly gateway:       GameEventsGateway,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Game Engine iniciando...');
    // Verifica se há uma rodada em andamento (restart do serviço)
    const existing = await this.roundRepo.findCurrent();
    if (existing?.isRunning) {
      this.logger.warn('Rodada em andamento detectada — crashando para recomeçar limpo');
      await this.forceFinishRound(existing);
    }
    await this.startNewRound();
  }

  onModuleDestroy(): void {
    this.clearTimers();
  }

  // ── Ciclo principal ────────────────────────────────────────────────────────

  /**
   * Inicia uma nova rodada completa:
   *  1. Gera seeds (provably fair)
   *  2. Calcula o crash point
   *  3. Persiste a rodada no banco
   *  4. Emite evento WebSocket round:new
   *  5. Agenda o fim da fase de apostas
   */
  async startNewRound(): Promise<void> {
    const seeds      = this.provablyFair.generateSeeds();
    const roundId    = randomUUID();
    const crashPoint = this.provablyFair.calculateCrashPoint(seeds.serverSeed, roundId);

    const round = Round.create({
      id:                roundId,
      serverSeed:        seeds.serverSeed,
      serverSeedHash:    seeds.serverSeedHash,
      crashPoint,
      bettingDurationMs: GameEngineService.BETTING_DURATION_MS,
    });

    await this.roundRepo.save(round);
    this.currentRound = round;

    this.logger.log(`Nova rodada: ${roundId} | crashPoint: ${crashPoint}x (secreto)`);

    // Emite para todos os clientes: nova rodada começou, fase de apostas aberta
    this.gateway.emitRoundNew({
      roundId,
      serverSeedHash: seeds.serverSeedHash,
      bettingEndsAt:  round.bettingEndsAt.toISOString(),
      bettingDurationMs: GameEngineService.BETTING_DURATION_MS,
    });

    // Agenda o fim da fase de apostas
    this.bettingTimeout = setTimeout(
      () => this.endBettingPhase(),
      GameEngineService.BETTING_DURATION_MS,
    );
  }

  /**
   * Fim da fase de apostas → inicia a rodada (multiplicador começa a subir).
   */
  private async endBettingPhase(): Promise<void> {
    if (!this.currentRound) return;

    this.currentRound.startRound();
    await this.roundRepo.update(this.currentRound);
    this.roundStartTime = Date.now();

    // Avisa clientes para desabilitar o botão de aposta
    this.gateway.emitBettingEnd({ roundId: this.currentRound.id });

    this.logger.log(`Rodada ${this.currentRound.id} INICIADA — multiplicador subindo`);

    // Inicia o loop de ticks
    this.tickInterval = setInterval(
      () => this.tick(),
      GameEngineService.TICK_INTERVAL_MS,
    );
  }

  /**
   * Tick do engine (a cada 100ms):
   *  1. Calcula o multiplicador atual via fórmula exponencial
   *  2. Emite o tick via WebSocket
   *  3. Verifica se deve crashar
   */
  private async tick(): Promise<void> {
    if (!this.currentRound || !this.roundStartTime) return;

    const elapsedMs    = Date.now() - this.roundStartTime;
    const multiplier   = this.calculateMultiplier(elapsedMs);
    const { shouldCrash } = this.currentRound.updateMultiplier(multiplier);

    // Emite o tick para todos os clientes
    this.gateway.emitMultiplierTick({
      roundId:    this.currentRound.id,
      multiplier: parseFloat(multiplier.toFixed(2)),
      elapsedMs,
    });

    if (shouldCrash) {
      await this.executeCrash();
    }
  }

  /**
   * Executa o crash da rodada:
   *  1. Para o loop de ticks
   *  2. Marca apostas pendentes como LOST
   *  3. Persiste no banco
   *  4. Emite eventos WebSocket e de domínio
   *  5. Agenda a próxima rodada
   */
  private async executeCrash(): Promise<void> {
    this.clearTimers();
    if (!this.currentRound) return;

    const round = this.currentRound;
    const { loserBets } = round.crash();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Persiste o crash e as apostas perdidas
      await queryRunner.query(
        `UPDATE rounds
         SET status = 'CRASHED', crashed_at = NOW(), current_multiplier = $1
         WHERE id = $2`,
        [round.currentMultiplier, round.id],
      );

      for (const bet of loserBets) {
        await queryRunner.query(
          `UPDATE bets SET status = 'LOST' WHERE id = $1`,
          [bet.id],
        );
      }

      // Publica evento de crash no outbox
      await this.outbox.saveToOutbox(
        GameEvents.ROUND_CRASHED,
        {
          eventId:     randomUUID(),
          roundId:     round.id,
          crashPoint:  round.currentMultiplier,
          loserBetIds: loserBets.map(b => b.id),
          crashedAt:   new Date().toISOString(),
        },
        queryRunner,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Erro ao persistir crash:', err);
    } finally {
      await queryRunner.release();
    }

    const snapshot = round.toPublicSnapshot();

    this.logger.log(
      `CRASH! Rodada ${round.id} | multiplicador: ${round.currentMultiplier}x | perdedores: ${loserBets.length}`,
    );

    // Emite o crash para todos os clientes (revela serverSeed para verificação)
    this.gateway.emitRoundCrashed({
      roundId:     round.id,
      crashPoint:  round.currentMultiplier,
      serverSeed:  snapshot.serverSeed!,
      serverSeedHash: round.serverSeedHash,
    });

    this.currentRound = null;
    this.roundStartTime = null;

    // Aguarda 3s e inicia nova rodada
    setTimeout(() => this.startNewRound(), 3_000);
  }

  // ── Ações públicas (chamadas pelos use cases) ──────────────────────────────

  /**
   * Registra uma aposta na rodada atual.
   * Chamado pelo PlaceBetUseCase após validações REST.
   */
  async placeBet(bet: Bet): Promise<void> {
    if (!this.currentRound) throw new NoActiveRoundError();
    this.currentRound.placeBet(bet);

    // Notifica todos os clientes em tempo real
    this.gateway.emitBetPlaced({
      roundId:     bet.roundId,
      betId:       bet.id,
      playerId:    bet.playerId,
      username:    bet.username,
      amountCents: serializeBigInt(bet.amount.cents),
    });
  }

  /**
   * Executa o cashout de um jogador.
   * Retorna o payout para o use case persistir e publicar o evento.
   */
  async cashOut(playerId: string): Promise<{ payout: Money; multiplier: number }> {
    if (!this.currentRound) throw new NoActiveRoundError();

    const { bet, payout } = this.currentRound.cashOut(playerId);

    // Notifica todos os clientes em tempo real
    this.gateway.emitBetCashout({
      roundId:     this.currentRound.id,
      betId:       bet.id,
      playerId:    bet.playerId,
      username:    bet.username,
      multiplier:  bet.cashoutAt!.value,
      payoutCents: serializeBigInt(payout.cents),
    });

    return { payout, multiplier: bet.cashoutAt!.value };
  }

  /** Retorna o snapshot público da rodada ativa (para GET /rounds/current). */
  getCurrentRoundSnapshot() {
    return this.currentRound?.toPublicSnapshot() ?? null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Calcula o multiplicador em função do tempo decorrido.
   * m(t) = e^(GROWTH_RATE × t)
   */
  private calculateMultiplier(elapsedMs: number): number {
    return Math.floor(
      Math.pow(Math.E, GameEngineService.GROWTH_RATE * elapsedMs) * 100,
    ) / 100;
  }

  private clearTimers(): void {
    if (this.tickInterval)   clearInterval(this.tickInterval);
    if (this.bettingTimeout) clearTimeout(this.bettingTimeout);
    this.tickInterval   = null;
    this.bettingTimeout = null;
  }

  private async forceFinishRound(round: Round): Promise<void> {
    await this.dataSource.query(
      `UPDATE rounds SET status = 'CRASHED', crashed_at = NOW() WHERE id = $1`,
      [round.id],
    );
    await this.dataSource.query(
      `UPDATE bets SET status = 'LOST' WHERE round_id = $1 AND status = 'PENDING'`,
      [round.id],
    );
  }
}

export class NoActiveRoundError extends Error {
  constructor() {
    super('Nenhuma rodada ativa no momento');
    this.name = 'NoActiveRoundError';
  }
}
