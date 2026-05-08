# ── Build stage ───────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Copia arquivos de dependências do monorepo
COPY package.json bun.lockb* ./
COPY packages/events/package.json ./packages/events/package.json
COPY services/games/package.json  ./services/games/package.json

# Instala dependências
RUN bun install --frozen-lockfile

# Copia o código-fonte
COPY packages/events ./packages/events
COPY services/games  ./services/games

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-slim

WORKDIR /app

# Copia tudo do builder (bun não precisa compilar TypeScript)
COPY --from=builder /app ./

WORKDIR /app/services/games

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

# Health check para o Docker Compose aguardar o serviço estar pronto
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:4001/games/health || exit 1

CMD ["bun", "run", "src/main.ts"]
