# Deployment

After making any code changes, verify the builds, commit, push to `main`, then
deploy. Full details in `DEPLOYMENT.md`.

## Verify before every push (same as CI)

```bash
cd backend  && npm run build
cd ../frontend && npx tsc -b --noEmit && npm run build
git add -A && git commit -m "description" && git push origin main
```

`.github/workflows/ci.yml` runs lint + typecheck + unit + e2e on every push to
`main`. It does **not** deploy.

## Production — VPS Contabo

Docker Compose stack on a Contabo VPS (`docker-compose.contabo.yml`), built on
the host from a git clone in `/opt/delivery-tracking`. HTTPS via Caddy + sslip.io.

Deploy = run the deploy script **on the VPS** over SSH:

```bash
ssh root@<IP-VPS> '/opt/delivery-tracking/scripts/deploy-contabo.sh'
```

It does: `git pull origin main` → `build --no-cache backend worker frontend` →
`up -d` → health-gate (backend + frontend healthy, `GET :8080/health` 200) →
`prisma migrate deploy` → **auto-rollback to the previous commit** if any check
fails. No push-triggered auto-deploy.

## Mobile (Capacitor Android)

Native Android shell lives in `frontend/android/` (generated assets are git-ignored).
Mode used: **app = site web** — `server.url` in `capacitor.config.ts` points to the
production site (`https://<IP-tirets>.sslip.io`), so the WebView loads the deployed
site and everything works like the website (Google OAuth, cookies, websockets,
geolocation, live notifications). No rebuild needed when the site updates.

1. Build the APK (Linux-compatible; Android SDK at `$HOME/android-sdk` or Android Studio):
   ```bash
   cd frontend && npx cap sync android
   cd frontend/android && ANDROID_HOME=$HOME/android-sdk ./gradlew assembleDebug
   # APK → frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```
2. To go back to bundled local assets (offline shell, no Google OAuth):
   - remove the `server` block from `capacitor.config.ts`,
   - `VITE_API_URL=https://<prod-host>/api npm run build`,
   - `npx cap sync android`, then reuse step 1.
3. In local-assets mode the backend must allow the app origin: `CORS_ORIGIN`
   accepts a comma-separated list — append `,https://localhost`.

## Docker Compose (local / self-host test)

```bash
git add -A && git commit -m "description"
docker compose -f docker-compose.prod.yml build --no-cache backend frontend worker
docker compose -f docker-compose.prod.yml up -d
```

## History

Production previously ran on Render (`render.yaml`, `keepalive.yml`) — migrated
to Contabo in August 2026. Oracle Cloud Always Free (ARM64) is a documented
alternative (`docker-compose.oracle.yml`). See `DEPLOYMENT.md`.
