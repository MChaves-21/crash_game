import {
  Controller, Post, Get, Body, Request,
  UseGuards, Query, Param, ParseIntPipe,
  DefaultValuePipe, HttpCode, HttpStatus,
  BadRequestException, NotFoundException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiBearerAuth, ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard }        from '../../infrastructure/auth/jwt-auth.guard';
import { PlaceBetUseCase }     from '../../application/use-cases/place-bet.use-case';
import { CashOutUseCase }      from '../../application/use-cases/cashout.use-case';
import {
  GetCurrentRoundUseCase,
  GetRoundHistoryUseCase,
  VerifyRoundUseCase,
  GetPlayerBetsUseCase,
} from '../../application/use-cases/query.use-cases';
import {
  BettingClosedError,
  DuplicateBetError,
  CashoutNotAvailableError,
  NoBetFoundError,
} from '../../domain/round/round.aggregate';
import { NoActiveRoundError } from '../../application/game-engine.service';
import {
  BetBelowMinimumError,
  BetAboveMaximumError,
} from '../../domain/bet/bet.entity';

// ── DTOs de request ───────────────────────────────────────────────────────────

class PlaceBetRequestDto {
  /** Valor da aposta em centavos (ex: 1000 = R$ 10,00) */
  amountCents!: number;
}

@ApiTags('Game')
@Controller()
export class GameController {
  constructor(
    private readonly placeBet:       PlaceBetUseCase,
    private readonly cashOut:        CashOutUseCase,
    private readonly getCurrentRound: GetCurrentRoundUseCase,
    private readonly getHistory:      GetRoundHistoryUseCase,
    private readonly verifyRound:     VerifyRoundUseCase,
    private readonly getPlayerBets:   GetPlayerBetsUseCase,
  ) {}

  // ── Endpoints públicos ─────────────────────────────────────────────────────

  @Get('rounds/current')
  @ApiOperation({ summary: 'Estado da rodada atual com apostas' })
  @ApiResponse({ status: 200, description: 'Rodada atual ou null se não houver' })
  getCurrentRound() {
    return this.getCurrentRound.execute();
  }

  @Get('rounds/history')
  @ApiOperation({ summary: 'Histórico paginado de rodadas finalizadas' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getHistory(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.getHistory.execute(page, limit);
  }

  @Get('rounds/:roundId/verify')
  @ApiOperation({ summary: 'Dados de verificação provably fair de uma rodada' })
  async verifyRound(@Param('roundId') roundId: string) {
    const result = await this.verifyRound.execute(roundId);
    if (!result) throw new NotFoundException(`Rodada ${roundId} não encontrada`);
    return result;
  }

  // ── Endpoints autenticados ─────────────────────────────────────────────────

  @Get('bets/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Histórico de apostas do jogador autenticado' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getMyBets(
    @Request() req: AuthRequest,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.getPlayerBets.execute(req.user.sub, page, limit);
  }

  @Post('bet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Fazer aposta na rodada atual' })
  @ApiResponse({ status: 201, description: 'Aposta registrada com sucesso' })
  @ApiResponse({ status: 400, description: 'Aposta inválida (valor, estado da rodada)' })
  @ApiResponse({ status: 409, description: 'Jogador já apostou nesta rodada' })
  async placeBet(
    @Body() body: PlaceBetRequestDto,
    @Request() req: AuthRequest,
  ) {
    if (!body.amountCents || body.amountCents <= 0) {
      throw new BadRequestException('amountCents deve ser um inteiro positivo');
    }

    try {
      return await this.placeBet.execute({
        playerId:    req.user.sub,
        username:    req.user.preferred_username ?? req.user.sub,
        amountCents: BigInt(Math.round(body.amountCents)),
      });
    } catch (err) {
      if (err instanceof DuplicateBetError)   throw new ConflictException(err.message);
      if (err instanceof BettingClosedError)  throw new ForbiddenException(err.message);
      if (err instanceof NoActiveRoundError)  throw new ForbiddenException(err.message);
      if (err instanceof BetBelowMinimumError || err instanceof BetAboveMaximumError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  @Post('bet/cashout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sacar no multiplicador atual' })
  @ApiResponse({ status: 200, description: 'Cashout executado com sucesso' })
  @ApiResponse({ status: 403, description: 'Rodada não está em execução ou sem aposta' })
  async cashOut(@Request() req: AuthRequest) {
    try {
      return await this.cashOut.execute({ playerId: req.user.sub });
    } catch (err) {
      if (err instanceof CashoutNotAvailableError) throw new ForbiddenException(err.message);
      if (err instanceof NoBetFoundError)          throw new ForbiddenException(err.message);
      if (err instanceof NoActiveRoundError)       throw new ForbiddenException(err.message);
      throw err;
    }
  }
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AuthRequest {
  user: {
    sub:                  string;
    preferred_username?:  string;
    email?:               string;
  };
}
