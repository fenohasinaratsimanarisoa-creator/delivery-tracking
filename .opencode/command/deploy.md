---
description: Build, commit, and push to main for Render auto-deploy.
---

1. Build both projects:
   - `cd backend && npm run build`
   - `cd frontend && npx tsc --noEmit && npm run build`
2. Stage all changes and commit: `git add -A && git commit -m "$ARGUMENTS"`
3. Push to main: `git push origin main`
4. Render will build the Docker images, run Prisma migrations, and deploy both services.
