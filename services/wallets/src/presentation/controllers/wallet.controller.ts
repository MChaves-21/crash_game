import {
  Controller, Post, Get, Request,
  UseGuards, HttpCode, HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard }             from '../../infrastructure/auth/jwt-auth.guard';
import { CreateWalletUseCase }      from '../../application/use-cases/wallet.use-cases';
import { GetMyWalletUseCase }       from '../../application/use-cases/wallet.use-cases';
import { GetTransactionHistoryUseCase } from '../../application/use-cases/wallet.use-cases';

/**
 * WalletController
 *
 * Endpoints REST do Wallet Service:
 *   POST /wallets       — cria carteira para o jogador autenticado
 *   GET  /wallets/me    — retorna carteira e saldo
 *   GET  /wallets/me/transactions — histórico de transações (bônus)
 *
 * Crédito e débito NÃO são expostos via REST — acontecem via RabbitMQ.
 * Isso garante que apenas o Game Service pode movimentar saldos,
 * e que toda movimentação tem um evento de domínio rastreável.
 */
@ApiTags('Wallet')
@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet:       CreateWalletUseCase,
    private readonly getMyWallet:        GetMyWalletUseCase,
    private readonly getTransactions:    GetTransactionHistoryUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria carteira para o jogador autenticado' })
  @ApiResponse({ status: 201, description: 'Carteira criada com R$ 1.000,00 de saldo inicial' })
  @ApiResponse({ status: 409, description: 'Jogador já possui carteira' })
  createWallet(@Request() req: AuthRequest) {
    return this.createWallet.execute({ playerId: req.user.sub });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna carteira e saldo do jogador autenticado' })
  @ApiResponse({ status: 200, description: 'Dados da carteira' })
  @ApiResponse({ status: 404, description: 'Carteira não encontrada — chamar POST /wallets primeiro' })
  async getMyWallet(@Request() req: AuthRequest) {
    const wallet = await this.getMyWallet.execute(req.user.sub);
    if (!wallet) {
      throw new NotFoundException(
        'Carteira não encontrada. Chame POST /wallets para criar.',
      );
    }
    return wallet;
  }

  @Get('me/transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Histórico de transações do jogador (paginado)' })
  getTransactions(@Request() req: AuthRequest) {
    return this.getTransactions.execute(req.user.sub);
  }
}

interface AuthRequest {
  user: { sub: string; preferred_username?: string };
}
