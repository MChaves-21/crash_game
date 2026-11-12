# 🦧 Jungle Gaming — Crash Game

> Desafio Full-stack: engine de crash game multiplayer em tempo real com NestJS, Bun, React e RabbitMQ.

## Setup em 2 comandos

```bash
git clone https://github.com/MChaves-21/crash_game.git
cd crash_game && bun install && bun run docker:up
```

Aguarde ~60s para o Keycloak inicializar. Tudo sobe automaticamente.

| Serviço           | URL                                    |
|-------------------|----------------------------------------|
| 🎮 Frontend        | http://localhost:3000                  |
| 🎯 Game API        | http://localhost:8000/games            |
| 💰 Wallet API      | http://localhost:8000/wallets          |
| 📖 Game Swagger    | http://localhost:4001/games/docs       |
| 📖 Wallet Swagger  | http://localhost:4002/wallets/docs     |
| 🐰 RabbitMQ UI     | http://localhost:15672 (guest/guest)   |
| 🔐 Keycloak Admin  | http://localhost:8080 (admin/admin)    |

**Usuário de teste:** `player` / `player123` — carteira criada automaticamente com R$ 1.000,00

---

## Comandos

```bash
bun run docker:up        # Sobe tudo
bun run docker:down      # Para os containers
bun run docker:prune     # Remove tudo (volumes incluídos)

# Testes
bun run test             # Unitários (games + wallets + frontend)
cd services/games   && bun test tests/unit
cd services/wallets && bun test tests/unit
cd frontend         && bun run test

# E2E (requer docker:up)
cd services/games   && bun test tests/e2e
cd services/wallets && bun test tests/e2e

# Seed determinístico para E2E
bun run docker/seed-e2e.ts
bun run docker/seed-e2e.ts -- --scenario crash-low
bun run docker/seed-e2e.ts -- --scenario high-multiplier
bun run docker/seed-e2e.ts -- --scenario house-wins

# Setup local (fora do Docker)
cp services/games/.env.example   services/games/.env
cp services/wallets/.env.example services/wallets/.env
cp frontend/.env.example         frontend/.env
```

---

## Arquitetura

```
Frontend (Vite + React + Tailwind)
    │ HTTP/REST + WebSocket
    ▼
Kong :8000  (API Gateway · CORS · Rate Limit 120 req/min)
    │                 │
Game Service :4001    Wallet Service :4002
(NestJS + Bun)        (NestJS + Bun)
    │                         │
    └──── RabbitMQ ───────────┘
          crash.events (topic exchange)
          game.wallet-events
          wallet.game-events
          crash.dead-letter (DLX)
    │
PostgreSQL :5432
├── games:   rounds, bets, outbox, inbox
└── wallets: wallets, transactions, outbox, inbox

Keycloak :8080 (realm: crash-game, PKCE S256)
```

---

## Fluxos de negócio

### Saga de aposta
```
POST /games/bet
→ GameEngine valida estado + invariantes de domínio
→ persiste bets + outbox(game.bet.placed) — mesma transação
→ OutboxPoller publica no RabbitMQ
→ Wallet debita saldo (FOR UPDATE) + persiste transaction + outbox(debit.approved)
→ WebSocket emite bet:placed para todos os clientes
```

### Saga de cashout
```
POST /games/bet/cashout
→ GameEngine captura multiplier.current (thread-safe)
→ persiste bets(CASHED_OUT) + outbox(game.bet.cashout) — mesma transação
→ Wallet credita payout + persiste transaction
→ WebSocket emite bet:cashout para todos os clientes
```

### Ciclo de rodada
```
BETTING (10s) → RUNNING → CRASHED → [3s] → nova BETTING
     │              │           │
  apostas      tick 100ms    seeds
  abertas      m(t)=e^(kt)  reveladas
```

---

## Decisões técnicas

### BigInt para dinheiro

`float` em JS: `0.1 + 0.2 === 0.30000000000000004`. Toda a cadeia usa centavos inteiros:

| Camada     | Tipo                 |
|------------|----------------------|
| Domínio    | `bigint` (Money VO)  |
| Banco      | `BIGINT` PostgreSQL  |
| Eventos    | `string` serializado |
| API        | `string`             |
| Frontend   | `bigint` Zustand     |

### Transactional Outbox + Inbox

**Outbox:** evento gravado na tabela `outbox` dentro da mesma transação do negócio. Poller lê e publica. Garante **at-least-once delivery** mesmo com falha do processo.

**Inbox:** consumidor insere `eventId` na tabela `inbox` antes de processar. `PRIMARY KEY` violation → evento duplicado → descarta. Garante **exactly-once processing**.

### Estado da rodada em memória

`GameEngineService` mantém o `Round` ativo em RAM para latência zero nos ticks (100ms). Banco atualizado apenas em eventos de estado (início, crash). Em caso de restart, rodada é forçada para CRASHED e nova rodada inicia limpa.

**Trade-off:** não escala horizontalmente. Em produção: Redis para estado da rodada + lock distribuído para cashout.

### WebSocket: servidor é a fonte de verdade

Frontend não interpola o multiplicador. Recebe o valor exato a cada 100ms via `multiplier:tick`. Payload inclui `elapsedMs` para recálculo local em caso de reconexão.

### Provably Fair (HMAC-SHA256)

```
Antes das apostas: serverSeedHash = HMAC(serverSeed, "hash") → publicado
Durante a rodada:  crashPoint = f(HMAC(serverSeed, roundId)) → secreto
Após o crash:      serverSeed revelado → verificável por qualquer um

h = HMAC(serverSeed, roundId)[0:8] → uint32
h % 33 === 0 → crash 1.00x (~3% house edge)
caso contrário → floor(100 × 2^32 / (2^32 - h)) / 100
```

Verificar via: `GET /games/rounds/:id/verify`

### Fórmula do multiplicador

```
m(t) = e^(0.00006 × t)    onde t = ms desde o início
m(10s)  ≈ 1.82x
m(30s)  ≈ 6.05x
m(60s)  ≈ 36.60x
```

---

## API Reference

### Game Service (`http://localhost:8000/games`)

| Método | Endpoint                        | Auth | Descrição                    |
|--------|---------------------------------|------|------------------------------|
| GET    | /rounds/current                 | —    | Estado da rodada atual       |
| GET    | /rounds/history?page=1&limit=20 | —    | Histórico paginado           |
| GET    | /rounds/:id/verify              | —    | Verificação provably fair    |
| GET    | /bets/me                        | JWT  | Minhas apostas               |
| POST   | /bet `{ amountCents: number }`  | JWT  | Fazer aposta                 |
| POST   | /bet/cashout                    | JWT  | Sacar no multiplicador atual |

### Wallet Service (`http://localhost:8000/wallets`)

| Método | Endpoint                  | Auth | Descrição                 |
|--------|---------------------------|------|---------------------------|
| POST   | /wallets                  | JWT  | Cria carteira             |
| GET    | /wallets/me               | JWT  | Saldo atual               |
| GET    | /wallets/me/transactions  | JWT  | Histórico de transações   |

### WebSocket (`ws://localhost:8000/games/socket.io`)

| Evento              | Payload principal                       |
|---------------------|-----------------------------------------|
| `round:new`         | roundId, serverSeedHash, bettingEndsAt  |
| `round:betting-end` | roundId                                 |
| `multiplier:tick`   | multiplier, elapsedMs                   |
| `round:crashed`     | crashPoint, serverSeed (revelado)       |
| `bet:placed`        | playerId, username, amountCents         |
| `bet:cashout`       | playerId, multiplier, payoutCents       |

---

## Testes

```
80+ casos no total:

games/tests/unit/
  domain.test.ts          — Money, Multiplier, Bet, Round, ProvablyFair
  provably-fair.test.ts   — algoritmo, house edge, verificação, edge cases
  game-engine.test.ts     — ciclo de vida, payouts, invariantes, fórmula

wallets/tests/unit/
  domain.test.ts          — Wallet, Money
  wallet-extended.test.ts — precisão, concorrência, reconstitute

games/tests/e2e/
  game.e2e.test.ts        — 7 fluxos: cashout, crash, validações

wallets/tests/e2e/
  wallet.e2e.test.ts      — 8 cenários: criação, débito/crédito, idempotência

frontend/src/stores/
  game.store.test.ts      — 22 testes do store Zustand
```

---

## Bônus implementados

| Item | Status |
|------|--------|
| Outbox/Inbox transacional | ✅ |
| CI pipeline (GitHub Actions) | ✅ |
| Seed determinístico para E2E | ✅ |
| Rate limiting (Kong) | ✅ |
| Fórmula da curva na UI | ✅ |
| Provably Fair com verificação independente | ✅ |
