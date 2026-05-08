-- =============================================================================
-- Wallet Service — Migration inicial
-- Banco: wallets (PostgreSQL 18)
-- Convenção: valores monetários em centavos (BIGINT), sem ponto flutuante
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Tabela: wallets
-- Uma carteira por jogador (player_id = sub do JWT Keycloak)
-- =============================================================================
CREATE TABLE wallets (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       VARCHAR(64) NOT NULL UNIQUE,  -- Sub do JWT (único por jogador)

    -- Saldo em centavos — BIGINT garante precisão monetária
    -- Invariante: nunca negativo (CHECK + lógica de domínio)
    balance_cents   BIGINT      NOT NULL DEFAULT 0
                    CONSTRAINT wallets_balance_non_negative
                    CHECK (balance_cents >= 0),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_player_id ON wallets (player_id);

-- =============================================================================
-- Tabela: transactions
-- Histórico imutável de todas as operações de crédito e débito.
-- Nunca deletar registros — é auditoria financeira.
-- =============================================================================
CREATE TABLE transactions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id       UUID        NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    player_id       VARCHAR(64) NOT NULL,

    type            VARCHAR(6)  NOT NULL
                    CONSTRAINT transactions_type_check
                    CHECK (type IN ('DEBIT', 'CREDIT')),

    -- Valor da operação em centavos
    amount_cents    BIGINT      NOT NULL
                    CONSTRAINT transactions_amount_positive
                    CHECK (amount_cents > 0),

    -- Saldo após a operação (snapshot para auditoria e reconciliação)
    balance_after_cents BIGINT  NOT NULL
                        CONSTRAINT transactions_balance_after_non_negative
                        CHECK (balance_after_cents >= 0),

    -- Referência à operação que originou (betId ou cashoutId)
    -- Usado para idempotência: mesmo reference_id nunca processa duas vezes
    reference_id    VARCHAR(64) NOT NULL UNIQUE,

    description     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice principal para histórico do jogador
CREATE INDEX idx_transactions_wallet_id ON transactions (wallet_id, created_at DESC);

-- Índice para idempotência (busca por reference_id antes de processar)
CREATE INDEX idx_transactions_reference_id ON transactions (reference_id);

-- =============================================================================
-- Tabela: outbox
-- Transactional Outbox: persiste evento junto com a transação de negócio.
-- Publisher lê e envia para RabbitMQ de forma assíncrona.
-- =============================================================================
CREATE TABLE outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50) NOT NULL,
    payload         JSONB       NOT NULL,
    published       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON outbox (created_at ASC)
    WHERE published = FALSE;

-- =============================================================================
-- Tabela: inbox
-- Transactional Inbox: garante idempotência no consumo de eventos do RabbitMQ.
-- Antes de processar qualquer mensagem, verificar se event_id já existe aqui.
-- =============================================================================
CREATE TABLE inbox (
    event_id        VARCHAR(64) PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,
    processed       BOOLEAN     NOT NULL DEFAULT FALSE,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_inbox_unprocessed ON inbox (received_at ASC)
    WHERE processed = FALSE;

-- =============================================================================
-- Seed: carteira do usuário de teste (player / player123 do Keycloak)
-- O player_id é o sub do JWT gerado pelo Keycloak para o usuário 'player'
-- Será substituído pelo sub real após o primeiro login
-- =============================================================================
INSERT INTO wallets (id, player_id, balance_cents)
VALUES (
    gen_random_uuid(),
    'test-player-id',   -- substituir pelo sub real do Keycloak
    100000              -- R$ 1.000,00 para testes
);
