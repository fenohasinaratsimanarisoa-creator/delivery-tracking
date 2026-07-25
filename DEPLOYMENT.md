# Deployment Guide — Delivery Tracking

## Render (Production)

Render auto-deploys both services from `main` branch.

- **Backend**: `deliverytrack-api` — Dockerfile in `./backend`
- **Frontend**: `deliverytrack-web` — Dockerfile in `./frontend`

### Environment
- **Plan**: Free tier (both services)
- **Database**: PostgreSQL on Render, free tier (90-day limit)
- **Redis**: Render Redis, free tier

### ⚠️ Free Tier Limitations

**Service Sleep**: On the free plan, Render puts web services to sleep after 15 minutes of inactivity. The first request after sleep triggers a cold start that can take 30-60 seconds — the user sees a 504 Gateway Timeout during this period. The service then works normally on subsequent requests.

**Mitigation**: A GitHub Actions cron workflow (`keepalive.yml`) pings the health endpoint every 5 minutes to prevent sleep. This keeps the service awake continuously.

**Database Expiration**: The free PostgreSQL tier expires after 90 days. The database for this project was provisioned around July 20, 2026. Expected expiration: ~October 18, 2026. **Migrate to a paid DB plan before this date to avoid data loss.**

### Troubleshooting 504 Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 504 on first request after idle period | Free tier sleep | Wait 30-60s, retry. Keepalive should prevent this. |
| 504 on all requests | DB connection pool exhausted | Check Render logs, restart service |
| 504 on Google OAuth | Google OAuth misconfig | Verify GOOGLE_CALLBACK_URL in Render env vars |
| Buttons disappear on login | Google status check failed | Fixed — "Créer un compte" always visible now |
| Generic "un problème est survenu" | Backend error (check logs) | Check Render logs for exact error |

### Deployment Commands

```bash
# Verify builds
cd backend && npm run build
cd ../frontend && npx tsc --noEmit && npm run build

# Commit & push (triggers Render auto-deploy)
git add -A && git commit -m "description" && git push origin master:main
```

### Manual Deploy

If auto-deploy doesn't trigger:
1. Go to Render dashboard → `deliverytrack-api` → Manual Deploy → Deploy latest commit
2. Same for `deliverytrack-web`
3. Wait for both to show "Live"

### Health Check

```
GET https://deliverytrack-api.onrender.com/health
→ {"status":"ok","timestamp":"...","checks":{"database":"ok","redis":"ok","queue":"ok"}}
```

### Upgrading from Free Tier

To eliminate sleep and DB expiration:
1. **Web services** (~$7/mo each): Upgrade from "Free" to "Starter" plan
2. **PostgreSQL** (~$7/mo): Upgrade from "Free" to "Starter" plan  
3. **Redis** (~$0/mo): Free tier has no expiration, keep as-is

Total: ~$21/mo for production-ready hosting.

### Infrastructure History

| Date | Event |
|------|-------|
| July 20, 2026 | Database provisioned (90-day timer starts) |
| July 24, 2026 | Login 504 diagnosed as free tier sleep |
| July 25, 2026 | Keepalive cron added to prevent sleep |
| ~Oct 18, 2026 | **DB free tier expires — migrate before this date** |
