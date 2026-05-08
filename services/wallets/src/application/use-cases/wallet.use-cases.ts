import { Injectable, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Wallet } from '../../domain/wallet/wallet.aggregate';
import { Money } from '../../domain/value-objects/money.vo';

// ── CreateWallet ──────────────────────────────────────────────────────────────

export interface CreateWalletDto {
  playerId: string;
}

export interface CreateWalletResult {
  id:           string;
  playerId:     string;
  balanceCents: string;
  createdAt:    Date;
}

/**
 * Use Case: CreateWallet
 *
 * Cria uma carteira para o jogador autenticado.
 * Cada jogador tem exatamente uma carteira (player_id é UNIQUE no banco).
 * Saldo inicial: R$ 1.000,00 (para facilitar os testes do desafio).
 */
@Injectable()
export class CreateWalletUseCase {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(dto: CreateWalletDto): Promise<CreateWalletResult> {
    // Verifica se já existe carteira para este player
    const [existing] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM wallets WHERE player_id = $1`,
      [dto.playerId],
    );

    if (existing) {
      throw new ConflictException(
        `Carteira já existe para o jogador ${dto.playerId}`,
      );
    }

    const wallet = Wallet.create({
      id:             randomUUID(),
      playerId:       dto.playerId,
      initialBalance: Money.fromDecimal(1000), // R$ 1.000,00
    });

    await this.dataSource.query(
      `INSERT INTO wallets (id, player_id, balance_cents, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [wallet.id, wallet.playerId, wallet.balance.cents.toString()],
    );

    return {
      id:           wallet.id,
      playerId:     wallet.playerId,
      balanceCents: wallet.balance.cents.toString(),
      createdAt:    wallet.createdAt,
    };
  }
}

// ── GetMyWallet ───────────────────────────────────────────────────────────────

export interface GetMyWalletResult {
  id:           string;
  playerId:     string;
  balanceCents: string;
  updatedAt:    Date;
}

/**
 * Use Case: GetMyWallet
 *
 * Retorna a carteira e o saldo atual do jogador autenticado.
 */
@Injectable()
export class GetMyWalletUseCase {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(playerId: string): Promise<GetMyWalletResult | null> {
    const [row] = await this.dataSource.query<WalletRow[]>(
      `SELECT id, player_id, balance_cents, updated_at
       FROM wallets
       WHERE player_id = $1`,
      [playerId],
    );

    if (!row) return null;

    return {
      id:           row.id,
      playerId:     row.player_id,
      balanceCents: row.balance_cents,  // BigInt serializado como string
      updatedAt:    new Date(row.updated_at),
    };
  }
}

// ── GetTransactionHistory ─────────────────────────────────────────────────────

/**
 * Use Case: GetTransactionHistory
 *
 * Retorna o histórico de transações de um jogador (paginado).
 * Útil para auditoria e debug durante o desafio.
 */
@Injectable()
export class GetTransactionHistoryUseCase {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async execute(playerId: string, page = 1, limit = 20) {
    const offset    = (page - 1) * limit;
    const safeLimit = Math.min(limit, 100);

    const [rows, [{ count }]] = await Promise.all([
      this.dataSource.query<TransactionRow[]>(
        `SELECT
           t.id, t.type, t.amount_cents, t.balance_after_cents,
           t.reference_id, t.description, t.created_at
         FROM transactions t
         JOIN wallets w ON w.id = t.wallet_id
         WHERE w.player_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [playerId, safeLimit, offset],
      ),
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*) as count
         FROM transactions t
         JOIN wallets w ON w.id = t.wallet_id
         WHERE w.player_id = $1`,
        [playerId],
      ),
    ]);

    const total = parseInt(count, 10);

    return {
      data: rows.map(r => ({
        id:               r.id,
        type:             r.type,
        amountCents:      r.amount_cents,
        balanceAfterCents: r.balance_after_cents,
        referenceId:      r.reference_id,
        description:      r.description,
        createdAt:        r.created_at,
      })),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }
}

// ── Tipos internos ────────────────────────────────────────────────────────────

interface WalletRow {
  id:            string;
  player_id:     string;
  balance_cents: string;
  updated_at:    string;
}

interface TransactionRow {
  id:                  string;
  type:                string;
  amount_cents:        string;
  balance_after_cents: string;
  reference_id:        string;
  description:         string;
  created_at:          string;
}
