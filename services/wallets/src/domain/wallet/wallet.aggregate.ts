import { Money, InsufficientFundsError } from '../value-objects/money.vo';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface WalletProps {
  id:         string;
  playerId:   string;
  balance:    Money;
  createdAt:  Date;
  updatedAt:  Date;
}

/**
 * Agregado Raiz: Wallet (Carteira)
 *
 * Gerencia o saldo do jogador em centavos (BigInt).
 *
 * Invariantes de domínio:
 *  - Saldo nunca pode ser negativo
 *  - Toda operação é registrada como Transaction
 *  - Débito é rejeitado se saldo insuficiente
 */
export class Wallet {
  private _props: WalletProps;
  private _pendingTransactions: TransactionRecord[] = [];

  private constructor(props: WalletProps) {
    this._props = props;
  }

  // ── Factories ─────────────────────────────────────────────────────────────

  static create(params: { id: string; playerId: string; initialBalance?: Money }): Wallet {
    return new Wallet({
      id:        params.id,
      playerId:  params.playerId,
      balance:   params.initialBalance ?? Money.fromDecimal(1000), // R$ 1.000 para testes
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static reconstitute(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  // ── Operações ─────────────────────────────────────────────────────────────

  /**
   * Debita um valor da carteira (aposta).
   * Lança InsufficientFundsError se saldo insuficiente.
   *
   * @param amount      Valor a debitar
   * @param referenceId ID da aposta (para idempotência)
   * @param description Descrição legível
   */
  debit(amount: Money, referenceId: string, description: string): void {
    if (this._props.balance.isLessThan(amount)) {
      throw new InsufficientFundsError(this._props.balance, amount);
    }

    this._props.balance = this._props.balance.subtract(amount);
    this._props.updatedAt = new Date();

    this._pendingTransactions.push({
      type:        'DEBIT',
      amount,
      referenceId,
      description,
      balanceAfter: this._props.balance,
      createdAt:    this._props.updatedAt,
    });
  }

  /**
   * Credita um valor na carteira (payout de cashout).
   * Crédito nunca falha — saldo só sobe.
   *
   * @param amount      Valor a creditar
   * @param referenceId ID do cashout (para idempotência)
   * @param description Descrição legível
   */
  credit(amount: Money, referenceId: string, description: string): void {
    this._props.balance   = this._props.balance.add(amount);
    this._props.updatedAt = new Date();

    this._pendingTransactions.push({
      type:        'CREDIT',
      amount,
      referenceId,
      description,
      balanceAfter: this._props.balance,
      createdAt:    this._props.updatedAt,
    });
  }

  /** Drena as transações pendentes (usadas pelo repositório para persistir). */
  pullPendingTransactions(): TransactionRecord[] {
    const transactions = [...this._pendingTransactions];
    this._pendingTransactions = [];
    return transactions;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get id():        string { return this._props.id; }
  get playerId():  string { return this._props.playerId; }
  get balance():   Money  { return this._props.balance; }
  get createdAt(): Date   { return this._props.createdAt; }
  get updatedAt(): Date   { return this._props.updatedAt; }

  canAfford(amount: Money): boolean {
    return this._props.balance.isGreaterThanOrEq(amount);
  }

  toSnapshot(): WalletProps {
    return { ...this._props };
  }
}

// ── Tipos de transação ────────────────────────────────────────────────────────

export type TransactionType = 'DEBIT' | 'CREDIT';

export interface TransactionRecord {
  type:         TransactionType;
  amount:       Money;
  referenceId:  string;   // betId ou cashoutId — garante idempotência
  description:  string;
  balanceAfter: Money;
  createdAt:    Date;
}
