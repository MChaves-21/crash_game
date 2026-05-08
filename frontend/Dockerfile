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

COPY packages/events ./packages/events
COPY frontend/       ./frontend/

WORKDIR /app/frontend

ARG VITE_API_URL=http://localhost:8000
ARG VITE_WS_URL=http://localhost:8000
ARG VITE_KEYCLOAK_URL=http://localhost:8080
ARG VITE_REALM=crash-game
ARG VITE_CLIENT_ID=crash-game-client

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_REALM=$VITE_REALM
ENV VITE_CLIENT_ID=$VITE_CLIENT_ID

RUN bun run build

# ── Runtime stage (nginx) ──────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

RUN echo 'server { \
  listen 3000; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \.(js|css|png|jpg|svg|ico|woff2)$ { \
    expires 1y; add_header Cache-Control "public, immutable"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s \
  CMD wget -qO- http://localhost:3000 || exit 1

CMD ["nginx", "-g", "daemon off;"]
