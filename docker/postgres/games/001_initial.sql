-- =============================================================================
-- Game Service — Migration inicial
-- Banco: games (PostgreSQL 18)
-- Convenção: valores monetários em centavos (BIGINT), timestamps com fuso horário
-- =============================================================================

-- Extensão para gerar UUIDs no banco
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Tabela: rounds
-- Representa cada rodada do Crash Game
-- =============================================================================
CREATE TABLE rounds (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Estado da máquina: BETTING → RUNNING → CRASHED
    status              VARCHAR(10) NOT NULL DEFAULT 'BETTING'
                        CONSTRAINT rounds_status_check
                        CHECK (status IN ('BETTING', 'RUNNING', 'CRASHED')),

    -- Provably Fair: serverSeedHash é público antes da rodada
    -- serverSeed é revelado apenas após o crash
    server_seed         VARCHAR(64) NOT NULL,
    server_seed_hash    VARCHAR(64) NOT NULL,

    -- crash_point é calculado deterministicamente antes da rodada
    -- Não é exposto enquanto a rodada estiver ativa
    crash_point         NUMERIC(10, 2) NOT NULL
                        CONSTRAINT rounds_crash_point_min CHECK (crash_point >= 1.00),

    -- Multiplicador atual — atualizado em tempo real pelo game engine
    current_multiplier  NUMERIC(10, 2) NOT NULL DEFAULT 1.00,

    -- Timestamps do ciclo de vida
    betting_ends_at     TIMESTAMPTZ NOT NULL,
    started_at          TIMESTAMPTZ,
    crashed_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para a consulta mais comum: rodada atual
CREATE INDEX idx_rounds_status_created ON rounds (status, created_at DESC);

-- Índice para histórico paginado
CREATE INDEX idx_rounds_crashed_at ON rounds (crashed_at DESC)
    WHERE status = 'CRASHED';

-- =============================================================================
-- Tabela: bets
-- Representa as apostas dos jogadores em cada rodada
-- =============================================================================
CREATE TABLE bets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id    UUID        NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
    player_id   VARCHAR(64) NOT NULL,   -- Sub do JWT (Keycloak)
    username    VARCHAR(100) NOT NULL,

    -- Valor em centavos (BIGINT) — NUNCA ponto flutuante
    amount_cents    BIGINT  NOT NULL
                    CONSTRAINT bets_amount_min CHECK (amount_cents >= 100)    -- R$ 1,00
                    CONSTRAINT bets_amount_max CHECK (amount_cents <= 100000), -- R$ 1.000,00

    -- Status da aposta
    status          VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                    CONSTRAINT bets_status_check
                    CHECK (status IN ('PENDING', 'CASHED_OUT', 'LOST')),

    -- Preenchido apenas no cashout
    cashout_at_multiplier   NUMERIC(10, 2),
    payout_cents            BIGINT
                            CONSTRAINT bets_payout_positive CHECK (payout_cents IS NULL OR payout_cents > 0),

    placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cashed_out_at   TIMESTAMPTZ
);

-- Garante uma aposta por jogador por rodada (invariante de domínio no banco)
CREATE UNIQUE INDEX idx_bets_player_round ON bets (player_id, round_id);

-- Índice para buscar apostas de um jogador
CREATE INDEX idx_bets_player_id ON bets (player_id, placed_at DESC);

-- Índice para buscar todas as apostas de uma rodada
CREATE INDEX idx_bets_round_id ON bets (round_id);

-- =============================================================================
-- Tabela: outbox
-- Padrão Transactional Outbox: garante que eventos são publicados exatamente
-- uma vez, mesmo em caso de falha entre a transação do banco e o RabbitMQ.
-- =============================================================================
CREATE TABLE outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50) NOT NULL,     -- ex: 'game.bet.placed'
    payload         JSONB       NOT NULL,
    published       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ
);

-- O publisher lê mensagens não publicadas em ordem de criação
CREATE INDEX idx_outbox_unpublished ON outbox (created_at ASC)
    WHERE published = FALSE;

-- =============================================================================
-- Tabela: inbox
-- Padrão Transactional Inbox: garante idempotência no consumo de eventos.
-- Antes de processar qualquer evento do RabbitMQ, verificar se eventId já existe.
-- =============================================================================
CREATE TABLE inbox (
    event_id    VARCHAR(64) PRIMARY KEY,  -- eventId do payload (UUID do emissor)
    event_type  VARCHAR(50) NOT NULL,
    processed   BOOLEAN     NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_inbox_unprocessed ON inbox (received_at ASC)
    WHERE processed = FALSE;
