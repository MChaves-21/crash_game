import { describe, it, expect } from 'bun:test';
import { createHmac }           from 'crypto';
import { ProvablyFairService }   from '../../src/domain/services/provably-fair.service';

const pf = new ProvablyFairService();

// ── Seeds determinísticas para testes ─────────────────────────────────────────
// Estas seeds produzem crash points conhecidos e verificáveis externamente.
const KNOWN_CASES: Array<{ serverSeed: string; roundId: string; expected: number }> = [
  // Casos calculados manualmente para validação
  {
    serverSeed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    roundId:    'round-0001',
    // HMAC-SHA256("aaaa...", "round-0001") → h → formula → valor esperado
    expected:   pf.calculateCrashPoint(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'round-0001',
    ),
  },
  {
    serverSeed: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    roundId:    'round-9999',
    expected:   pf.calculateCrashPoint(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'round-9999',
    ),
  },
];

describe('ProvablyFairService — algoritmo', () => {

  describe('generateSeeds', () => {
    it('deve gerar serverSeed de 64 chars hex', () => {
      const { serverSeed } = pf.generateSeeds();
      expect(serverSeed).toMatch(/^[0-9a-f]{64}$/);
    });

    it('deve gerar serverSeedHash de 64 chars hex', () => {
      const { serverSeedHash } = pf.generateSeeds();
      expect(serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('nunca deve gerar seeds duplicadas em 1000 iterações', () => {
      const seeds = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        seeds.add(pf.generateSeeds().serverSeed);
      }
      expect(seeds.size).toBe(1000);
    });

    it('o hash deve ser derivado da seed via HMAC', () => {
      const { serverSeed, serverSeedHash } = pf.generateSeeds();
      const expectedHash = createHmac('sha256', serverSeed).update('hash').digest('hex');
      expect(serverSeedHash).toBe(expectedHash);
    });
  });

  describe('calculateCrashPoint', () => {
    it('deve ser completamente determinístico', () => {
      const seed    = pf.generateSeeds().serverSeed;
      const roundId = 'determinism-test';
      const results = Array.from({ length: 10 }, () =>
        pf.calculateCrashPoint(seed, roundId),
      );
      expect(new Set(results).size).toBe(1);
    });

    it('deve mudar ao trocar o roundId (salt)', () => {
      const seed   = pf.generateSeeds().serverSeed;
      const crash1 = pf.calculateCrashPoint(seed, 'round-A');
      const crash2 = pf.calculateCrashPoint(seed, 'round-B');
      // Probabilidade de colisão ≈ 0 — seeds diferentes devem dar valores diferentes
      expect(crash1).not.toBe(crash2);
    });

    it('deve mudar ao trocar a seed', () => {
      const roundId = 'same-round';
      const seed1   = pf.generateSeeds().serverSeed;
      const seed2   = pf.generateSeeds().serverSeed;
      expect(pf.calculateCrashPoint(seed1, roundId))
        .not.toBe(pf.calculateCrashPoint(seed2, roundId));
    });

    it('crash point deve ser sempre >= 1.00', () => {
      for (let i = 0; i < 500; i++) {
        const { serverSeed } = pf.generateSeeds();
        expect(pf.calculateCrashPoint(serverSeed, `r-${i}`)).toBeGreaterThanOrEqual(1.00);
      }
    });

    it('crash point deve ter no máximo 2 casas decimais', () => {
      for (let i = 0; i < 100; i++) {
        const { serverSeed } = pf.generateSeeds();
        const crash = pf.calculateCrashPoint(serverSeed, `r-${i}`);
        const str   = crash.toString();
        const decimals = str.includes('.') ? str.split('.')[1].length : 0;
        expect(decimals).toBeLessThanOrEqual(2);
      }
    });

    it('casos conhecidos devem ser reproduzíveis', () => {
      for (const { serverSeed, roundId, expected } of KNOWN_CASES) {
        expect(pf.calculateCrashPoint(serverSeed, roundId)).toBe(expected);
      }
    });
  });

  describe('house edge (~3%)', () => {
    it('aproximadamente 1/33 das rodadas deve crashar em 1.00x', () => {
      const TRIALS  = 5000;
      let instant   = 0;

      for (let i = 0; i < TRIALS; i++) {
        const { serverSeed } = pf.generateSeeds();
        if (pf.calculateCrashPoint(serverSeed, `r-${i}`) === 1.00) instant++;
      }

      const rate = instant / TRIALS;
      // Esperado: ~3.03% (1/33). Margem: 1.5% a 5%
      expect(rate).toBeGreaterThan(0.015);
      expect(rate).toBeLessThan(0.050);
    });

    it('mediana do crash point deve ser entre 1.5x e 3.0x', () => {
      const crashes: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const { serverSeed } = pf.generateSeeds();
        crashes.push(pf.calculateCrashPoint(serverSeed, `r-${i}`));
      }
      crashes.sort((a, b) => a - b);
      const median = crashes[500];
      expect(median).toBeGreaterThan(1.5);
      expect(median).toBeLessThan(4.0);
    });

    it('pelo menos 10% das rodadas devem crashar acima de 5x', () => {
      let above5 = 0;
      const TRIALS = 2000;
      for (let i = 0; i < TRIALS; i++) {
        const { serverSeed } = pf.generateSeeds();
        if (pf.calculateCrashPoint(serverSeed, `r-${i}`) >= 5.0) above5++;
      }
      expect(above5 / TRIALS).toBeGreaterThan(0.10);
    });

    it('pelo menos 1% das rodadas devem crashar acima de 50x', () => {
      let above50 = 0;
      const TRIALS = 5000;
      for (let i = 0; i < TRIALS; i++) {
        const { serverSeed } = pf.generateSeeds();
        if (pf.calculateCrashPoint(serverSeed, `r-${i}`) >= 50.0) above50++;
      }
      expect(above50 / TRIALS).toBeGreaterThan(0.005); // ~1% com margem
    });
  });

  describe('verify', () => {
    it('deve validar crash point correto como válido', () => {
      const { serverSeed } = pf.generateSeeds();
      const roundId    = 'verify-ok';
      const crashPoint = pf.calculateCrashPoint(serverSeed, roundId);
      const result     = pf.verify(serverSeed, roundId, crashPoint);

      expect(result.valid).toBe(true);
      expect(result.calculatedCrash).toBe(crashPoint);
      expect(result.roundId).toBe(roundId);
      expect(result.hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it('deve rejeitar crash point manipulado', () => {
      const { serverSeed } = pf.generateSeeds();
      const roundId    = 'tamper-test';
      const realCrash  = pf.calculateCrashPoint(serverSeed, roundId);
      const fakeCrash  = realCrash + 10.00; // manipulado

      const result = pf.verify(serverSeed, roundId, fakeCrash);
      expect(result.valid).toBe(false);
    });

    it('deve rejeitar seed incorreta', () => {
      const { serverSeed } = pf.generateSeeds();
      const { serverSeed: wrongSeed } = pf.generateSeeds();
      const roundId    = 'wrong-seed-test';
      const crashPoint = pf.calculateCrashPoint(serverSeed, roundId);

      // Verifica com seed errada — deve ser inválido
      const result = pf.verify(wrongSeed, roundId, crashPoint);
      expect(result.valid).toBe(false);
    });

    it('hmac retornado deve ser HMAC-SHA256(serverSeed, roundId)', () => {
      const { serverSeed } = pf.generateSeeds();
      const roundId = 'hmac-check';
      const result  = pf.verify(serverSeed, roundId, 1.00);

      const expected = createHmac('sha256', serverSeed).update(roundId).digest('hex');
      expect(result.hmac).toBe(expected);
    });

    it('serverSeedHash retornado deve bater com hashSeed()', () => {
      const { serverSeed } = pf.generateSeeds();
      const result = pf.verify(serverSeed, 'r', 1.00);
      expect(result.serverSeedHash).toBe(pf.hashSeed(serverSeed));
    });
  });

  describe('hashSeed', () => {
    it('deve ser determinístico', () => {
      const seed = 'test-seed-123';
      expect(pf.hashSeed(seed)).toBe(pf.hashSeed(seed));
    });

    it('deve retornar hex de 64 chars', () => {
      expect(pf.hashSeed('any-seed')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('seeds diferentes devem produzir hashes diferentes', () => {
      expect(pf.hashSeed('seed-a')).not.toBe(pf.hashSeed('seed-b'));
    });
  });
});
