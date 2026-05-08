import { create } from 'zustand';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type RoundStatus = 'BETTING' | 'RUNNING' | 'CRASHED' | 'IDLE';

export interface BetEntry {
  betId:       string;
  playerId:    string;
  username:    string;
  amountCents: bigint;
  status:      'PENDING' | 'CASHED_OUT' | 'LOST';
  multiplier?: number;
  payoutCents?: bigint;
}

export interface HistoryEntry {
  roundId:    string;
  crashPoint: number;
  crashedAt:  string;
}

export interface GameState {
  // Rodada atual
  roundId:          string | null;
  status:           RoundStatus;
  multiplier:       number;
  serverSeedHash:   string | null;
  bettingEndsAt:    Date | null;
  bets:             Map<string, BetEntry>;   // betId → BetEntry
  history:          HistoryEntry[];

  // Minha aposta na rodada atual
  myBet:            BetEntry | null;

  // Carteira
  balanceCents:     bigint;

  // Player info (do JWT)
  playerId:         string | null;
  username:         string | null;

  // WebSocket
  wsConnected:      boolean;

  // UI
  countdownMs:      number;
}

export interface GameActions {
  // WebSocket events
  onRoundNew:       (payload: RoundNewPayload)       => void;
  onBettingEnd:     (payload: { roundId: string })   => void;
  onMultiplierTick: (payload: MultiplierTickPayload)  => void;
  onRoundCrashed:   (payload: RoundCrashedPayload)   => void;
  onBetPlaced:      (payload: BetPlacedPayload)      => void;
  onBetCashout:     (payload: BetCashoutPayload)      => void;

  // Ações locais
  setPlayer:        (playerId: string, username: string) => void;
  setBalance:       (cents: bigint)                  => void;
  setMyBet:         (bet: BetEntry | null)           => void;
  setWsConnected:   (v: boolean)                     => void;
  setCountdown:     (ms: number)                     => void;
  loadCurrentRound: (round: any)                     => void;
}

// ── Payload types (espelham os do gateway) ────────────────────────────────────

interface RoundNewPayload {
  roundId: string; serverSeedHash: string;
  bettingEndsAt: string; bettingDurationMs: number;
}
interface MultiplierTickPayload { roundId: string; multiplier: number; elapsedMs: number; }
interface RoundCrashedPayload   { roundId: string; crashPoint: number; serverSeed: string; serverSeedHash: string; }
interface BetPlacedPayload      { roundId: string; betId: string; playerId: string; username: string; amountCents: string; }
interface BetCashoutPayload     { roundId: string; betId: string; playerId: string; username: string; multiplier: number; payoutCents: string; }

// ── Store ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  // Estado inicial
  roundId:        null,
  status:         'IDLE',
  multiplier:     1.00,
  serverSeedHash: null,
  bettingEndsAt:  null,
  bets:           new Map(),
  history:        [],
  myBet:          null,
  balanceCents:   0n,
  playerId:       null,
  username:       null,
  wsConnected:    false,
  countdownMs:    0,

  // ── WebSocket handlers ──────────────────────────────────────────────────

  onRoundNew: (p) => set({
    roundId:        p.roundId,
    status:         'BETTING',
    multiplier:     1.00,
    serverSeedHash: p.serverSeedHash,
    bettingEndsAt:  new Date(p.bettingEndsAt),
    bets:           new Map(),
    myBet:          null,
    countdownMs:    p.bettingDurationMs,
  }),

  onBettingEnd: () => set({ status: 'RUNNING', bettingEndsAt: null, countdownMs: 0 }),

  onMultiplierTick: (p) => set({ multiplier: p.multiplier }),

  onRoundCrashed: (p) => {
    const { history, bets, myBet, balanceCents } = get();

    // Marca todas as apostas pendentes como perdidas
    const updatedBets = new Map(bets);
    for (const [id, bet] of updatedBets) {
      if (bet.status === 'PENDING') updatedBets.set(id, { ...bet, status: 'LOST' });
    }

    const updatedMyBet = myBet?.status === 'PENDING'
      ? { ...myBet, status: 'LOST' as const }
      : myBet;

    set({
      status:    'CRASHED',
      multiplier: p.crashPoint,
      bets:      updatedBets,
      myBet:     updatedMyBet,
      history: [
        { roundId: p.roundId, crashPoint: p.crashPoint, crashedAt: new Date().toISOString() },
        ...history.slice(0, 19),
      ],
    });
  },

  onBetPlaced: (p) => {
    const { bets } = get();
    const updated = new Map(bets);
    const entry: BetEntry = {
      betId:       p.betId,
      playerId:    p.playerId,
      username:    p.username,
      amountCents: BigInt(p.amountCents),
      status:      'PENDING',
    };
    updated.set(p.betId, entry);
    set({ bets: updated });
  },

  onBetCashout: (p) => {
    const { bets, myBet, balanceCents, playerId } = get();
    const updated = new Map(bets);
    const bet = updated.get(p.betId);
    if (bet) {
      updated.set(p.betId, {
        ...bet,
        status:      'CASHED_OUT',
        multiplier:  p.multiplier,
        payoutCents: BigInt(p.payoutCents),
      });
    }

    // Atualiza saldo se for minha aposta
    const isMine = p.playerId === playerId;
    const newMyBet = isMine && myBet
      ? { ...myBet, status: 'CASHED_OUT' as const, multiplier: p.multiplier, payoutCents: BigInt(p.payoutCents) }
      : myBet;

    set({
      bets:  updated,
      myBet: newMyBet,
      balanceCents: isMine ? balanceCents + BigInt(p.payoutCents) : balanceCents,
    });
  },

  // ── Ações locais ────────────────────────────────────────────────────────

  setPlayer:      (playerId, username) => set({ playerId, username }),
  setBalance:     (cents) => set({ balanceCents: cents }),
  setMyBet:       (bet)   => set({ myBet: bet }),
  setWsConnected: (v)     => set({ wsConnected: v }),
  setCountdown:   (ms)    => set({ countdownMs: ms }),

  loadCurrentRound: (round) => {
    if (!round) return;
    const bets = new Map<string, BetEntry>();
    for (const b of round.bets ?? []) {
      bets.set(b.id, {
        betId:       b.id,
        playerId:    b.playerId,
        username:    b.username,
        amountCents: BigInt(b.amountCents),
        status:      b.status,
        multiplier:  b.cashoutAtMultiplier,
        payoutCents: b.payoutCents ? BigInt(b.payoutCents) : undefined,
      });
    }
    set({
      roundId:        round.id,
      status:         round.status,
      multiplier:     round.currentMultiplier ?? 1.00,
      serverSeedHash: round.serverSeedHash,
      bettingEndsAt:  round.bettingEndsAt ? new Date(round.bettingEndsAt) : null,
      bets,
    });
  },
}));

// ── Formatadores ──────────────────────────────────────────────────────────────

export function formatCents(cents: bigint): string {
  const reais    = cents / 100n;
  const centavos = cents % 100n;
  return `R$ ${reais.toLocaleString('pt-BR')},${centavos.toString().padStart(2, '0')}`;
}

export function formatMultiplier(m: number): string {
  return `${m.toFixed(2)}x`;
}
