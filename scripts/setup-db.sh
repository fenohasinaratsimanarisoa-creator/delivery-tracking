#!/bin/bash
set -e

echo "=== Delivery Tracking - Database Setup ==="

# Check if running with Docker
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
  echo "Docker detected. Starting containers..."
  cd "$(dirname "$0")/.."
  docker compose up -d postgres redis
  echo "Waiting for PostgreSQL to be ready..."
  until docker compose exec -T postgres pg_isready -U delivery_user -d delivery_tracking; do
    sleep 1
  done
  echo "Database ready!"
else
  echo "Docker not found. Attempting local setup..."

  # Try to create user and database
  sudo -u postgres psql <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'delivery_user') THEN
        CREATE ROLE delivery_user WITH LOGIN PASSWORD 'delivery_pass';
      END IF;
    END
    \$\$;
EOSQL

  sudo -u postgres createdb -O delivery_user delivery_tracking 2>/dev/null || true

  # Install PostGIS extension if not present
  sudo -u postgres psql -d delivery_tracking -c "CREATE EXTENSION IF NOT EXISTS postgis;"
  sudo -u postgres psql -d delivery_tracking -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
fi

echo "=== Database setup complete ==="
echo "Run: cd backend && npx prisma migrate dev --name init"
