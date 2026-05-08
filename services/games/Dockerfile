# ── Build stage ───────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Copia TODOS os package.json dos workspaces
# O Bun precisa encontrar todos eles para resolver o monorepo
COPY package.json bun.lockb* ./
COPY packages/events/package.json  ./packages/events/package.json
COPY services/games/package.json   ./services/games/package.json
COPY services/wallets/package.json ./services/wallets/package.json
COPY frontend/package.json         ./frontend/package.json

# Instala dependências
RUN bun install --frozen-lockfile

# Copia apenas o código necessário para este serviço
COPY packages/events ./packages/events
COPY services/games  ./services/games

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app ./

WORKDIR /app/services/games

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:4001/games/health || exit 1

CMD ["bun", "run", "src/main.ts"]
