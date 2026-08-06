# Deployment

After making any code changes, you MUST deploy.

## Mobile (Capacitor Android)

Native Android shell lives in `frontend/android/` (generated assets are git-ignored).
Mode used: **app = site web** (`server.url` → `https://deliverytrack-web.onrender.com` in
`capacitor.config.ts`) — the WebView loads the deployed site, so everything works exactly
like the website (Google OAuth, cookies, websockets, geolocation, live notifications).
No rebuild needed when the site updates.

1. Build the APK (Linux-compatible; Android SDK at `$HOME/android-sdk` or Android Studio):
   ```bash
   cd frontend && npx cap sync android
   cd frontend/android && ANDROID_HOME=$HOME/android-sdk ./gradlew assembleDebug
   # APK → frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```
2. To go back to bundled local assets (offline shell, no Google OAuth):
   - remove the `server` block from `capacitor.config.ts`,
   - `VITE_API_URL=https://deliverytrack-api.onrender.com/api npm run build`,
   - `npx cap sync android`, then reuse step 1.
3. In local-assets mode the backend must allow the app origin: `CORS_ORIGIN`
   (Render env) accepts a comma-separated list — append `,https://localhost`.

## Render (production)

Render auto-deploys both backend (`deliverytrack-api`) and frontend (`deliverytrack-web`) from `main`.

1. **Verify builds** (both must succeed):
   - Backend: `cd backend && npm run build`
   - Frontend: `cd frontend && npx tsc --noEmit && npm run build`
2. **Commit & push**: `git add -A && git commit -m "description" && git push origin master:main`
3. Render builds both Docker images, runs Prisma migrations, and deploys.

## Docker Compose (local/staging)

```bash
git add -A && git commit -m "description"
docker compose -f docker-compose.prod.yml build --no-cache backend frontend worker
docker compose -f docker-compose.prod.yml up -d
