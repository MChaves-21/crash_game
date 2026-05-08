# ── Build stage ───────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Copia TODOS os package.json dos workspaces
COPY package.json bun.lockb* ./
COPY packages/events/package.json  ./packages/events/package.json
COPY services/games/package.json   ./services/games/package.json
COPY services/wallets/package.json ./services/wallets/package.json
COPY frontend/package.json         ./frontend/package.json

RUN bun install --frozen-lockfile

COPY packages/events  ./packages/events
COPY services/wallets ./services/wallets

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app ./

WORKDIR /app/services/wallets

ENV NODE_ENV=production
ENV PORT=4002

EXPOSE 4002

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:4002/wallets/health || exit 1

CMD ["bun", "run", "src/main.ts"]
