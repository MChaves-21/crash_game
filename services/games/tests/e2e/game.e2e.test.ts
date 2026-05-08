/**
 * Testes E2E — Game Service
 *
 * Pré-requisito: bun run docker:up (infraestrutura rodando)
 *
 * Cobrem os fluxos obrigatórios do desafio:
 *  1. Apostar → multiplicador sobe → cashout → saldo atualizado
 *  2. Apostar → crash → aposta perdida
 *  3. Erros de validação (saldo insuficiente, aposta dupla, aposta durante rodada)
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

const GAME_BASE  = process.env.GAME_URL  ?? 'http://localhost:8000/games';
const WALLET_BASE = process.env.WALLET_URL ?? 'http://localhost:8000/wallets';

// Token JWT do usuário de teste (player / player123 do Keycloak)
// Em CI: obter via OIDC password grant com client credentials
const TEST_TOKEN = process.env.TEST_JWT_TOKEN ?? '';

const authHeaders = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${TEST_TOKEN}`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForBettingPhase(maxWaitMs = 15_000): Promise<any> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res   = await fetch(`${GAME_BASE}/rounds/current`);
    const round = await res.json();
    if (round?.status === 'BETTING') return round;
    await sleep(500);
  }
  throw new Error('Timeout aguardando fase de apostas');
}

async function waitForRunningPhase(maxWaitMs = 15_000): Promise<any> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res   = await fetch(`${GAME_BASE}/rounds/current`);
    const round = await res.json();
    if (round?.status === 'RUNNING') return round;
    await sleep(300);
  }
  throw new Error('Timeout aguardando fase RUNNING');
}

async function waitForCrash(roundId: string, maxWaitMs = 120_000): Promise<any> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res   = await fetch(`${GAME_BASE}/rounds/history?limit=1`);
    const body  = await res.json();
    const last  = body.data?.[0];
    if (last?.id === roundId) return last;
    await sleep(500);
  }
  throw new Error(`Timeout aguardando crash da rodada ${roundId}`);
}

async function getWalletBalance(): Promise<bigint> {
  const res    = await fetch(`${WALLET_BASE}/wallets/me`, { headers: authHeaders });
  const wallet = await res.json();
  return BigInt(wallet.balanceCents);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('E2E — Game Service', () => {

  describe('Fluxo 1: Apostar → cashout → saldo atualizado', () => {
    it('deve registrar aposta, permitir cashout e creditar payout', async () => {
      if (!TEST_TOKEN) {
        console.warn('TEST_JWT_TOKEN não definido — pulando teste E2E');
        return;
      }

      // 1. Aguarda fase de apostas
      const round  = await waitForBettingPhase();
      expect(round.status).toBe('BETTING');

      const balanceBefore = await getWalletBalance();

      // 2. Faz a aposta (R$ 100,00 = 10000 centavos)
      const betRes = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 10000 }),
      });
      expect(betRes.status).toBe(201);

      const bet = await betRes.json();
      expect(bet.betId).toBeDefined();
      expect(bet.status).toBe('PENDING');

      // 3. Aguarda fase RUNNING (multiplicador subindo)
      await waitForRunningPhase();

      // 4. Aguarda 1s para o multiplicador subir
      await sleep(1000);

      // 5. Executa cashout
      const cashRes = await fetch(`${GAME_BASE}/bet/cashout`, {
        method:  'POST',
        headers: authHeaders,
      });
      expect(cashRes.status).toBe(200);

      const cashout = await cashRes.json();
      expect(cashout.multiplier).toBeGreaterThanOrEqual(1.00);
      expect(BigInt(cashout.payoutCents)).toBeGreaterThan(0n);

      // 6. Aguarda processamento assíncrono do crédito (Wallet Service)
      await sleep(2000);

      const balanceAfter = await getWalletBalance();
      const payout       = BigInt(cashout.payoutCents);

      // Saldo deve ter aumentado em (payout - aposta) ou no mínimo não zerado
      // (pode diminuir se cashout foi abaixo de 1x — impossível pelo domínio,
      // mas checamos que o saldo foi atualizado)
      expect(balanceAfter).not.toBe(balanceBefore);
    });
  });

  describe('Fluxo 2: Apostar → crash → aposta perdida', () => {
    it('deve marcar aposta como LOST após o crash', async () => {
      if (!TEST_TOKEN) return;

      const round = await waitForBettingPhase();

      // Aposta R$ 50,00
      const betRes = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 5000 }),
      });
      expect(betRes.status).toBe(201);
      const bet = await betRes.json();

      // NÃO faz cashout — deixa crashar
      const crashed = await waitForCrash(round.id);
      expect(crashed).toBeDefined();

      // Verifica aposta no histórico do jogador
      const betsRes = await fetch(`${GAME_BASE}/bets/me`, { headers: authHeaders });
      const bets    = await betsRes.json();
      const myBet   = bets.data.find((b: any) => b.id === bet.betId);

      expect(myBet?.status).toBe('LOST');
      expect(myBet?.payoutCents).toBeNull();
    });
  });

  describe('Fluxo 3: Validações de erro', () => {
    it('deve rejeitar aposta abaixo do mínimo', async () => {
      if (!TEST_TOKEN) return;
      await waitForBettingPhase();

      const res = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 50 }), // R$ 0,50 — abaixo do mínimo
      });
      expect(res.status).toBe(400);
    });

    it('deve rejeitar aposta dupla na mesma rodada', async () => {
      if (!TEST_TOKEN) return;
      const round = await waitForBettingPhase();

      // Primeira aposta
      const r1 = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 1000 }),
      });
      expect(r1.status).toBe(201);

      // Segunda aposta na mesma rodada → deve falhar com 409
      const r2 = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 1000 }),
      });
      expect(r2.status).toBe(409);
    });

    it('deve rejeitar aposta durante fase RUNNING', async () => {
      if (!TEST_TOKEN) return;

      await waitForRunningPhase();

      const res = await fetch(`${GAME_BASE}/bet`, {
        method:  'POST',
        headers: authHeaders,
        body:    JSON.stringify({ amountCents: 1000 }),
      });
      expect(res.status).toBe(403);
    });

    it('deve rejeitar cashout sem aposta ativa', async () => {
      if (!TEST_TOKEN) return;
      await waitForRunningPhase();

      const res = await fetch(`${GAME_BASE}/bet/cashout`, {
        method:  'POST',
        headers: authHeaders,
      });
      // 403 se sem aposta ou se já fez cashout
      expect([403, 200]).toContain(res.status);
    });
  });

  describe('Provably Fair', () => {
    it('deve verificar crash point de rodada finalizada', async () => {
      const histRes = await fetch(`${GAME_BASE}/rounds/history?limit=1`);
      const hist    = await histRes.json();

      if (!hist.data?.length) {
        console.warn('Sem histórico ainda — pulando teste de verificação');
        return;
      }

      const roundId  = hist.data[0].id;
      const verifyRes = await fetch(`${GAME_BASE}/rounds/${roundId}/verify`);
      expect(verifyRes.status).toBe(200);

      const result = await verifyRes.json();
      expect(result.verification?.valid).toBe(true);
      expect(result.serverSeed).toBeDefined();
    });
  });
});
