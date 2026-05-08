import { createHmac, randomBytes } from 'crypto';

/**
 * Domain Service: ProvablyFairService
 *
 * Garante que o crash point é pré-determinado e verificável pelo jogador,
 * provando que o cassino não manipula resultados após as apostas.
 *
 * Como funciona:
 *  1. Antes da rodada: gerado um serverSeed aleatório. O hash SHA-256 dele
 *     é publicado ANTES das apostas (compromisso).
 *  2. Após a rodada: o serverSeed real é revelado. O jogador pode verificar
 *     que o hash bate e recalcular o crash point por conta própria.
 *
 * Algoritmo (inspirado em Bustabit / stake.com):
 *  1. HMAC-SHA256(serverSeed, roundId) → hex string de 64 chars
 *  2. Pega os primeiros 8 chars do hex → uint32
 *  3. Se uint32 % 33 === 0 → crash em 1.00x (house edge de ~3%)
 *  4. Caso contrário → crashPoint = floor(100 × e^(h / 2^32)) / 100
 *     onde h = uint32 (distribui exponencialmente favorecendo valores baixos)
 */
export class ProvablyFairService {
  private static readonly HOUSE_EDGE_MODULO = 33; // ~3% de chance de crash imediato

  /**
   * Gera seeds para uma nova rodada.
   * O serverSeedHash é publicado antes das apostas.
   * O serverSeed só é revelado após o crash.
   */
  generateSeeds(): RoundSeeds {
    const serverSeed     = randomBytes(32).toString('hex');
    const serverSeedHash = this.hashSeed(serverSeed);
    return { serverSeed, serverSeedHash };
  }

  /**
   * Calcula o crash point de forma determinística.
   * Pode ser chamado por qualquer um que conheça o serverSeed e roundId.
   *
   * @param serverSeed  Seed secreto revelado após a rodada
   * @param roundId     ID da rodada (salt público)
   * @returns           Crash point como número (ex: 2.48)
   */
  calculateCrashPoint(serverSeed: string, roundId: string): number {
    const hmac = createHmac('sha256', serverSeed)
      .update(roundId)
      .digest('hex');

    // Pega os primeiros 8 chars do hex → inteiro de 32 bits
    const h = parseInt(hmac.slice(0, 8), 16);

    // House edge: ~1/33 das rodadas crasham imediatamente em 1.00x
    if (h % ProvablyFairService.HOUSE_EDGE_MODULO === 0) {
      return 1.00;
    }

    // Distribuição exponencial do crash point
    // Quanto menor o h, mais próximo de 1.00x (crash rápido)
    // Quanto maior o h, maior o multiplicador possível
    const MAX_UINT32  = 2 ** 32;
    const crashPoint  = Math.floor(100 * (MAX_UINT32 / (MAX_UINT32 - h))) / 100;

    return Math.max(1.00, crashPoint);
  }

  /**
   * Verifica se um crash point é válido para um dado par seed/roundId.
   * Exposto via GET /games/rounds/:roundId/verify
   */
  verify(serverSeed: string, roundId: string, claimedCrashPoint: number): VerificationResult {
    const expectedSeedHash   = this.hashSeed(serverSeed);
    const calculatedCrash    = this.calculateCrashPoint(serverSeed, roundId);
    const hmac               = createHmac('sha256', serverSeed).update(roundId).digest('hex');
    const crashMatches       = Math.abs(calculatedCrash - claimedCrashPoint) < 0.001;

    return {
      valid:             crashMatches,
      serverSeedHash:    expectedSeedHash,
      calculatedCrash,
      hmac,
      roundId,
    };
  }

  hashSeed(seed: string): string {
    return createHmac('sha256', seed).update('hash').digest('hex');
  }
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface RoundSeeds {
  serverSeed: string;
  serverSeedHash: string;
}

export interface VerificationResult {
  valid: boolean;
  serverSeedHash: string;
  calculatedCrash: number;
  hmac: string;
  roundId: string;
}
