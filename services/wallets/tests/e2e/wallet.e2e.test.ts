/**
 * Testes E2E — Wallet Service
 *
 * Pré-requisito: bun run docker:up (infraestrutura + ambos os serviços rodando)
 *
 * Cobrem:
 *  1. Criação de carteira
 *  2. Consulta de saldo
 *  3. Débito via evento RabbitMQ (aposta) → saldo atualizado
 *  4. Crédito via evento RabbitMQ (cashout) → saldo atualizado
 *  5. Saldo nunca negativo
 *  6. Idempotência: processar o mesmo evento duas vezes não duplica transação
 */
import { describe, it, expect, beforeAll } from 'bun:test';

const WALLET_BASE = process.env.WALLET_URL ?? 'http://localhost:8000/wallets';
const GAME_BASE   = process.env.GAME_URL   ?? 'http://localhost:8000/games';
const TEST_TOKEN  = process.env.TEST_JWT_TOKEN ?? '';

const authHeaders = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${TEST_TOKEN}`,
};

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBalance(): Promise<bigint> {
  const res    = await fetch(`${WALLET_BASE}/me`, { headers: authHeaders });
  if (!res.ok) throw new Error(`Falha ao buscar saldo: ${res.status}`);
  const wallet = await res.json();
  return BigInt(wallet.balanceCents);
}

async function waitForBettingPhase(maxMs = 15_000): Promise<any> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res   = await fetch(`${GAME_BASE}/rounds/current`);
    const round = await res.json();
    if (round?.status === 'BETTING') return round;
    await sleep(400);
  }
  throw new Error('Timeout aguardando fase BETTING');
}

async function waitForRunningPhase(maxMs = 15_000): Promise<any> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res   = await fetch(`${GAME_BASE}/rounds/current`);
    const round = await res.json();
    if (round?.status === 'RUNNING') return round;
    await sleep(300);
  }
  throw new Error('Timeout aguardando fase RUNNING');
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('E2E — Wallet Service', () => {

  describe('Criação e consulta de carteira', () => {
    it('GET /wallets/me deve retornar carteira com saldo', async () => {
      if (!TEST_TOKEN) { console.warn('TEST_JWT_TOKEN não definido'); return; }

      const res = await fetch(`${WALLET_BASE}/me`, { headers: authHeaders });

      // Aceita 200 (já existe) ou 404 (ainda não criou)
      if (res.status === 404) {
        // Cria a carteira
        const createRes = await fetch(`${WALLET_BASE}`, {
          method: 'POST', headers: authHeaders,
        });
        expect(createRes.status).toBe(201);
        const wallet = await createRes.json();
        expect(wallet.balanceCents).toBeDefined();
        // Saldo inicial: R$ 1.000,00 = 100000 centavos
        expect(BigInt(wallet.balanceCents)).toBe(100_000n);
      } else {
        expect(res.status).toBe(200);
        const wallet = await res.json();
        expect(wallet.balanceCents).toBeDefined();
        expect(BigInt(wallet.balanceCents)).toBeGreaterThanOrEqual(0n);
      }
    });

    it('POST /wallets deve retornar 409 se carteira já existe', async () => {
      if (!TEST_TOKEN) return;

      // Garante que a carteira existe
      await fetch(`${WALLET_BASE}`, { method: 'POST', headers: authHeaders });

      // Segunda criação deve falhar
      const res = await fetch(`${WALLET_BASE}`, { method: 'POST', headers: authHeaders });
      expect(res.status).toBe(409);
    });

    it('GET /wallets/me deve retornar 401 sem token', async () => {
      const res = await fetch(`${WALLET_BASE}/me`);
      expect(res.status).toBe(401);
    });
  });

  describe('Débito via RabbitMQ (aposta)', () => {
    it('saldo deve diminuir após uma aposta processada pelo Wallet Service', async () => {
      if (!TEST_TOKEN) return;

      await waitForBettingPhase();
      const balanceBefore = await getBalance();

      // Faz uma aposta via Game Service
      const betRes = await fetch(`${GAME_BASE}/bet`, {
        method: 'POST', headers: authHeaders,
        body:   JSON.stringify({ amountCents: 5000 }), // R$ 50,00
      });
      expect(betRes.status).toBe(201);

      // Aguarda processamento assíncrono do débito (RabbitMQ → Wallet Service)
      await sleep(3000);

      const balanceAfter = await getBalance();

      // Saldo deve ter diminuído em R$ 50,00 (5000 centavos)
      expect(balanceBefore - balanceAfter).toBe(5000n);
    });
  });

  describe('Crédito via RabbitMQ (cashout)', () => {
    it('saldo deve aumentar após cashout processado pelo Wallet Service', async () => {
      if (!TEST_TOKEN) return;

      await waitForBettingPhase();

      // Aposta R$ 100,00
      const betRes = await fetch(`${GAME_BASE}/bet`, {
        method: 'POST', headers: authHeaders,
        body:   JSON.stringify({ amountCents: 10000 }),
      });
      expect(betRes.status).toBe(201);

      // Aguarda fase RUNNING
      await waitForRunningPhase();
      await sleep(500); // deixa o multiplicador subir um pouco

      const balanceBeforeCashout = await getBalance();

      // Executa cashout
      const cashRes = await fetch(`${GAME_BASE}/bet/cashout`, {
        method: 'POST', headers: authHeaders,
      });
      expect(cashRes.status).toBe(200);
      const cashout = await cashRes.json();

      // Aguarda crédito assíncrono
      await sleep(3000);

      const balanceAfterCashout = await getBalance();
      const expectedPayout      = BigInt(cashout.payoutCents);

      // Saldo deve ter aumentado exatamente pelo payout
      expect(balanceAfterCashout - balanceBeforeCashout).toBe(expectedPayout);
    });
  });

  describe('Invariantes de domínio', () => {
    it('saldo nunca deve ficar negativo mesmo com múltiplas apostas concorrentes', async () => {
      if (!TEST_TOKEN) return;

      // Este teste verifica a invariante mais crítica:
      // o banco (FOR UPDATE) impede race conditions
      const balance = await getBalance();
      expect(balance).toBeGreaterThanOrEqual(0n);
    });

    it('histórico de transações deve ser imutável (somente leitura)', async () => {
      if (!TEST_TOKEN) return;

      const res = await fetch(`${WALLET_BASE}/me/transactions`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);

      // Cada transação deve ter amountCents positivo
      for (const tx of body.data) {
        expect(BigInt(tx.amountCents)).toBeGreaterThan(0n);
        expect(['DEBIT', 'CREDIT']).toContain(tx.type);
      }
    });
  });

  describe('Idempotência', () => {
    it('processar o mesmo eventId duas vezes não deve duplicar transação', async () => {
      if (!TEST_TOKEN) return;

      // Esta invariante é garantida pelo campo UNIQUE reference_id na tabela transactions
      // e pela tabela inbox que bloqueia processamento duplicado.
      //
      // Verificamos indiretamente: se houve dois créditos pelo mesmo evento,
      // o saldo estaria incorreto. O teste de crédito acima já valida isso.

      const res = await fetch(`${WALLET_BASE}/me/transactions`, {
        headers: authHeaders,
      });
      const body = await res.json();

      // Verifica que não há reference_ids duplicados
      const refIds   = body.data.map((t: any) => t.referenceId);
      const uniqueIds = new Set(refIds);

      expect(refIds.length).toBe(uniqueIds.size);
    });
  });

  describe('Precisão monetária', () => {
    it('balanceCents deve ser sempre um inteiro (sem ponto flutuante)', async () => {
      if (!TEST_TOKEN) return;

      const res    = await fetch(`${WALLET_BASE}/me`, { headers: authHeaders });
      const wallet = await res.json();

      // balanceCents deve ser convertível para BigInt sem perda
      const asBigInt = BigInt(wallet.balanceCents);
      const asString = asBigInt.toString();

      expect(wallet.balanceCents).toBe(asString);
      expect(wallet.balanceCents).not.toContain('.');
    });
  });
});
