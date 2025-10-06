Persistence and local dev with Redis

This project needs persistent session/data storage in production to avoid losing users when the app restarts or is redeployed.

Quick local/dev stack (Docker Compose)
- `docker-compose.local.yml` brings up Redis and mounts a persistent volume for the app's data directory.

Commands
1. Build and start the stack:

```powershell
docker compose -f docker-compose.local.yml up --build
```

2. Open the app at http://localhost:3000

What this does
- Redis runs at `redis:6379` (app connects using `REDIS_URL=redis://redis:6379`).
- The app's `DATA_DIR` is mounted at `/data` inside the container and persisted to the named volume `app-data`.

Production notes
- On Render or other platforms, use a managed Redis and a persistent disk for the DB directory, or migrate to a managed Postgres.
- Ensure `SESSION_SECRET` is a stable, strong secret in production.

Install dependencies locally

If you haven't installed dependencies required for the session adapters, run:

```powershell
npm install connect-sqlite3 connect-redis ioredis
```

If you prefer Redis only, `npm install connect-redis ioredis` is sufficient.
