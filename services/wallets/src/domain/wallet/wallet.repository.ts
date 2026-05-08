import { Wallet } from '../wallet/wallet.aggregate';

/**
 * Port: IWalletRepository
 *
 * Contrato definido pelo domínio.
 * Implementado em infrastructure/persistence/wallet.repository.ts.
 *
 * Toda operação de escrita deve persistir as transactions pendentes
 * (via wallet.pullPendingTransactions()) na mesma transação de banco.
 */
export interface IWalletRepository {
  /** Cria uma nova carteira. */
  save(wallet: Wallet): Promise<void>;

  /**
   * Atualiza saldo e persiste transactions pendentes.
   * Deve usar uma única transação de banco (atomicidade).
   */
  update(wallet: Wallet): Promise<void>;

  /** Busca carteira pelo ID. */
  findById(id: string): Promise<Wallet | null>;

  /** Busca carteira pelo playerId (sub do JWT). */
  findByPlayerId(playerId: string): Promise<Wallet | null>;

  /**
   * Busca carteira com lock pessimista (FOR UPDATE).
   * Usado pelo consumer de eventos para evitar race conditions.
   */
  findByPlayerIdForUpdate(
    playerId: string,
    queryRunner: import('typeorm').QueryRunner,
  ): Promise<Wallet | null>;
}
