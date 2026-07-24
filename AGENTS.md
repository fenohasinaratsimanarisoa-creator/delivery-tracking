# Deployment

After making any code changes, you MUST deploy.

## Render (production)

Render auto-deploys both backend (`deliverytrack-api`) and frontend (`deliverytrack-web`) from `main`.

1. **Verify builds** (both must succeed):
   - Backend: `cd backend && npm run build`
   - Frontend: `cd frontend && npx tsc --noEmit && npm run build`
2. **Commit & push**: `git add -A && git commit -m "description" && git push origin main`
3. Render builds both Docker images, runs Prisma migrations, and deploys.

## Docker Compose (local/staging)

```bash
git add -A && git commit -m "description"
docker compose -f docker-compose.prod.yml build --no-cache backend frontend worker
docker compose -f docker-compose.prod.yml up -d
