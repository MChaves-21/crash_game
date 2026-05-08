#!/bin/bash
# Cria os dois bancos de dados necessários e roda as migrations de cada um

set -e

echo "🗄️  Criando bancos de dados..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE games;
  CREATE DATABASE wallets;
EOSQL

echo "✅ Bancos criados: games, wallets"

echo "📦 Rodando migrations do banco 'games'..."
for f in /docker-entrypoint-initdb.d/games/*.sql; do
  echo "  → $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname="games" -f "$f"
done

echo "📦 Rodando migrations do banco 'wallets'..."
for f in /docker-entrypoint-initdb.d/wallets/*.sql; do
  echo "  → $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname="wallets" -f "$f"
done

echo "🎉 Migrations concluídas!"
