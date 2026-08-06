# Deployment

After making any code changes, you MUST deploy.

## Mobile (Capacitor Android)

Native Android shell lives in `frontend/android/` (generated assets are git-ignored).
Web and mobile share the same Vite codebase; only the backend URL differs.

1. Build the web app targeting the remote API (web itself stays same-origin via nginx proxy;
   native has no proxy, so it needs an absolute URL):
   ```bash
   cd frontend
   VITE_API_URL=https://deliverytrack-api.onrender.com/api npm run build
   npx cap sync android
   ```
2. Build the APK (Linux-compatible; Android SDK at `$HOME/android-sdk` or Android Studio):
   ```bash
   cd frontend/android && ANDROID_HOME=$HOME/android-sdk ./gradlew assembleDebug
   # APK → frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```
3. Native login also requires the backend to allow the app's WebView origin:
   `CORS_ORIGIN` (Render env, or `http://localhost:5173` default) now accepts a
   comma-separated list — append `,https://localhost` for Capacitor Android.
4. Changing backend URL at runtime without rebuild: set `localStorage['dt-api-base']`.
5. Native limits: Google OAuth (`/api/auth/google`) and push notifications are not wired yet
   (need custom URL scheme + native plugins).

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
