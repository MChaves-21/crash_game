#!/usr/bin/env bun
/**
 * seed-e2e.ts — Seed determinístico para testes E2E
 *
 * Popula o banco de dados com um estado conhecido e reproduzível,
 * permitindo simular cenários específicos (crash em 1.5x, sequência de rodadas, etc).
 *
 * Uso:
 *   bun run docker/seed-e2e.ts
 *   bun run docker/seed-e2e.ts --scenario crash-low
 *   bun run docker/seed-e2e.ts --scenario high-multiplier
 *
 * Pré-requisito: docker:up rodando
 */

import { createHmac } from 'crypto';

const DB_URL    = process.env.DATABASE_URL_GAMES   ?? 'postgresql://postgres:postgres@localhost:5432/games';
const WALLET_DB = process.env.DATABASE_URL_WALLETS ?? 'postgresql://postgres:postgres@localhost:5432/wallets';

// ── Seeds determinísticas para cenários específicos ───────────────────────────

const SCENARIOS = {
  /** Crash em ~1.50x — testa apostas perdidas */
  'crash-low': {
    serverSeed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0001',
    description: 'crash-low: resultado entre 1.00x e 2.00x',
  },
  /** Crash em valor alto — testa grandes payouts */
  'high-multiplier': {
    serverSeed: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    description: 'high-multiplier: crash point elevado (>10x)',
  },
  /** Casa ganha — crash imediato em 1.00x */
  'house-wins': {
    serverSeed: '0000000000000000000000000000000000000000000000000000000000000000',
    description: 'house-wins: crash em 1.00x (house edge)',
  },
  /** Padrão — seeds aleatórias */
  default: {
    serverSeed: null,
    description: 'default: seeds aleatórias',
  },
} as const;

// ── Provably Fair inline ──────────────────────────────────────────────────────

function calculateCrashPoint(serverSeed: string, roundId: string): number {
  const hmac = createHmac('sha256', serverSeed).update(roundId).digest('hex');
  const h    = parseInt(hmac.slice(0, 8), 16);
  if (h % 33 === 0) return 1.00;
  return Math.max(1.00, Math.floor(100 * (2 ** 32 / (2 ** 32 - h))) / 100);
}

function hashSeed(seed: string): string {
  return createHmac('sha256', seed).update('hash').digest('hex');
}

function randomHex(len = 64): string {
  const chars = '0123456789abcdef';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  const scenario = (process.argv[3] ?? 'default') as keyof typeof SCENARIOS;
  const config   = SCENARIOS[scenario] ?? SCENARIOS.default;

  console.log(`\n🌱 Seed E2E — cenário: ${scenario}`);
  console.log(`   ${config.description}\n`);

  // Importação dinâmica do cliente PostgreSQL
  const { default: postgres } = await import('postgres').catch(() => {
    throw new Error('Instale o pacote postgres: bun add postgres');
  });

  const gamesDb   = postgres(DB_URL);
  const walletsDb = postgres(WALLET_DB);

  try {
    // ── Limpa dados de teste anteriores ──────────────────────────────────
    await gamesDb`   DELETE FROM outbox WHERE true`;
    await gamesDb`   DELETE FROM inbox  WHERE true`;
    await gamesDb`   DELETE FROM bets   WHERE true`;
    await gamesDb`   DELETE FROM rounds WHERE true`;
    await walletsDb` DELETE FROM outbox       WHERE true`;
    await walletsDb` DELETE FROM inbox        WHERE true`;
    await walletsDb` DELETE FROM transactions WHERE true`;
    await walletsDb` DELETE FROM wallets      WHERE true`;
    console.log('✅ Dados anteriores limpos');

    // ── Cria carteira do jogador de teste ─────────────────────────────────
    const TEST_PLAYER_ID = 'seed-player-001';
    await walletsDb`
      INSERT INTO wallets (id, player_id, balance_cents)
      VALUES (gen_random_uuid(), ${TEST_PLAYER_ID}, 1000000)
    `; // R$ 10.000,00 para testes
    console.log(`✅ Carteira criada: R$ 10.000,00 (playerId=${TEST_PLAYER_ID})`);

    // ── Cria histórico de 10 rodadas passadas ─────────────────────────────
    const history: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const seed       = config.serverSeed ?? randomHex();
      const roundId    = `seed-round-${String(i).padStart(4, '0')}`;
      const crashPoint = calculateCrashPoint(seed, roundId);
      const seedHash   = hashSeed(seed);

      await gamesDb`
        INSERT INTO rounds
          (id, status, server_seed, server_seed_hash, crash_point, current_multiplier,
           betting_ends_at, started_at, crashed_at, created_at)
        VALUES (
          ${roundId}, 'CRASHED', ${seed}, ${seedHash}, ${crashPoint}, ${crashPoint},
          NOW() - INTERVAL '${i * 30} seconds',
          NOW() - INTERVAL '${i * 30 - 10} seconds',
          NOW() - INTERVAL '${i * 30 - 25} seconds',
          NOW() - INTERVAL '${i * 30} seconds'
        )
      `;

      // Adiciona uma aposta em cada rodada histórica
      const betId = `seed-bet-hist-${i}`;
      const betAmt = 1000 + (i * 500); // varia entre R$ 10,00 e R$ 60,00
      const status = crashPoint > 2.0 ? 'CASHED_OUT' : 'LOST';
      const payout = status === 'CASHED_OUT' ? Math.floor(betAmt * crashPoint) : null;

      await gamesDb`
        INSERT INTO bets
          (id, round_id, player_id, username, amount_cents, status,
           cashout_at_multiplier, payout_cents, placed_at, cashed_out_at)
        VALUES (
          ${betId}, ${roundId}, ${TEST_PLAYER_ID}, 'seedplayer', ${betAmt},
          ${status},
          ${status === 'CASHED_OUT' ? crashPoint : null},
          ${payout},
          NOW() - INTERVAL '${i * 30 - 2} seconds',
          ${status === 'CASHED_OUT' ? `NOW() - INTERVAL '${i * 30 - 15} seconds'` : null}
        )
      `;

      history.push(`  Round ${i}: crash=${crashPoint}x | bet=${status}`);
    }

    console.log('✅ Histórico de 10 rodadas criado:');
    history.forEach(h => console.log(h));

    // ── Cria rodada atual em fase BETTING ─────────────────────────────────
    const currentSeed    = config.serverSeed ?? randomHex();
    const currentRoundId = 'seed-round-current';
    const currentCrash   = calculateCrashPoint(currentSeed, currentRoundId);

    await gamesDb`
      INSERT INTO rounds
        (id, status, server_seed, server_seed_hash, crash_point, current_multiplier,
         betting_ends_at, created_at)
      VALUES (
        ${currentRoundId}, 'BETTING', ${currentSeed}, ${hashSeed(currentSeed)},
        ${currentCrash}, 1.00,
        NOW() + INTERVAL '8 seconds',
        NOW()
      )
    `;

    console.log(`\n✅ Rodada atual criada:`);
    console.log(`   id:          ${currentRoundId}`);
    console.log(`   crashPoint:  ${currentCrash}x (secreto)`);
    console.log(`   seedHash:    ${hashSeed(currentSeed).slice(0, 20)}...`);
    console.log(`   status:      BETTING (apostas abertas por ~8s)`);

    console.log(`\n🎉 Seed E2E completo! Serviços prontos para teste.\n`);
    console.log(`Para verificar qualquer rodada:`);
    console.log(`  curl http://localhost:8000/games/rounds/${currentRoundId}/verify\n`);

  } finally {
    await gamesDb.end();
    await walletsDb.end();
  }
}

seed().catch(err => {
  console.error('❌ Erro no seed:', err.message);
  process.exit(1);
});
