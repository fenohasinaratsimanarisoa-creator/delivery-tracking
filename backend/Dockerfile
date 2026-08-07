FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
# --include=dev : garantit que typescript/ts-node (utilisés par nest build ET le
# seed prisma/seed.ts) sont installés même si NODE_ENV=production est actif au build.
RUN npm ci --ignore-scripts --include=dev && npm rebuild bcrypt
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
RUN npx nest build

FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY package*.json ./
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
ENV PRISMA_QUERY_ENGINE_BINARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
RUN chown -R node:node /app/node_modules/@prisma/engines /app/node_modules/.prisma
USER node
EXPOSE 3000
CMD sh -c '
if [ "$RESET_DATABASE" = "true" ]; then
  npx prisma migrate reset --force
else
  npx prisma migrate deploy || {
    echo "[startup] migrate deploy a échoué — auto-réparation : résolution de 20260807000000_add_digest_sent_at puis reprise";
    npx prisma migrate resolve --applied 20260807000000_add_digest_sent_at && npx prisma migrate deploy || exit 1;
  }
fi
if [ -n "$SEED_ADMIN_EMAIL" ]; then echo "[startup] SEED_ADMIN_EMAIL set — seeding super admin ($SEED_ADMIN_EMAIL)"; npx ts-node prisma/seed.ts || echo "[startup] WARNING: seed failed (continuing)"; else echo "[startup] SEED_ADMIN_EMAIL not set — seed skipped"; fi
node dist/src/main'
