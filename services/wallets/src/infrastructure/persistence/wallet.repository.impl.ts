import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { Wallet, WalletProps } from '../../domain/wallet/wallet.aggregate';
import { Money }   from '../../domain/value-objects/money.vo';
import { IWalletRepository } from '../../domain/wallet/wallet.repository';

/**
 * WalletRepositoryImpl
 *
 * Implementação concreta de IWalletRepository.
 * Usa o padrão pull de transações: wallet.pullPendingTransactions()
 * retorna as transações pendentes que devem ser persistidas junto com o update.
 */
@Injectable()
export class WalletRepositoryImpl implements IWalletRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async save(wallet: Wallet): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO wallets (id, player_id, balance_cents, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [wallet.id, wallet.playerId, wallet.balance.cents.toString()],
    );
  }

  async update(wallet: Wallet): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      await qr.query(
        `UPDATE wallets
         SET balance_cents = $1, updated_at = NOW()
         WHERE id = $2`,
        [wallet.balance.cents.toString(), wallet.id],
      );

      // Persiste as transações pendentes (débitos e créditos)
      for (const tx of wallet.pullPendingTransactions()) {
        await qr.query(
          `INSERT INTO transactions
             (wallet_id, player_id, type, amount_cents,
              balance_after_cents, reference_id, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (reference_id) DO NOTHING`,
          [
            wallet.id,
            wallet.playerId,
            tx.type,
            tx.amount.cents.toString(),
            tx.balanceAfter.cents.toString(),
            tx.referenceId,
            tx.description,
          ],
        );
      }

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async findById(id: string): Promise<Wallet | null> {
    const [row] = await this.dataSource.query<WalletRow[]>(
      `SELECT id, player_id, balance_cents, created_at, updated_at
       FROM wallets WHERE id = $1`,
      [id],
    );
    return row ? this.hydrate(row) : null;
  }

  async findByPlayerId(playerId: string): Promise<Wallet | null> {
    const [row] = await this.dataSource.query<WalletRow[]>(
      `SELECT id, player_id, balance_cents, created_at, updated_at
       FROM wallets WHERE player_id = $1`,
      [playerId],
    );
    return row ? this.hydrate(row) : null;
  }

  async findByPlayerIdForUpdate(
    playerId: string,
    queryRunner: QueryRunner,
  ): Promise<Wallet | null> {
    const [row] = await queryRunner.query<WalletRow[]>(
      `SELECT id, player_id, balance_cents, created_at, updated_at
       FROM wallets WHERE player_id = $1 FOR UPDATE`,
      [playerId],
    );
    return row ? this.hydrate(row) : null;
  }

  private hydrate(row: WalletRow): Wallet {
    const props: WalletProps = {
      id:        row.id,
      playerId:  row.player_id,
      balance:   Money.fromCents(BigInt(row.balance_cents)),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return Wallet.reconstitute(props);
  }
}

interface WalletRow {
  id:            string;
  player_id:     string;
  balance_cents: string;
  created_at:    string;
  updated_at:    string;
}
