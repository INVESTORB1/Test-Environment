Render deployment guide (persistent DB + Redis)

This guide explains how to set up Render so your users and sessions are persisted across deploys.

1) Provision a managed Postgres database
- In Render dashboard -> Databases -> Create a new Postgres instance.
- Note the connection string (DATABASE_URL).

2) Provision a managed Redis (or use Render's Redis add-on if available)
- Note the REDIS_URL connection string.

3) Configure your Web Service
- Set the following environment variables for the service:
  - DATABASE_URL (from the Postgres instance)
  - REDIS_URL (from the Redis instance)
  - SESSION_SECRET (generate a long random secret and keep it stable)
  - DATA_DIR (optional; if you still use SQLite locally, set this to a persistent mount)

4) Attach persistent disk (if you keep SQLite)
- For Render Private Services, attach a persistent disk and set DATA_DIR to the mounted path (e.g. `/persist/data`).
- Ensure your service writes its DB files to that path (the app uses DATA_DIR to control where the SQLite DB lives).

5) Deploy
- Push to your connected repo and deploy; the app will detect DATABASE_URL and use Postgres for persistence.

6) Migration
- Run the migration script locally or on the server after setting DATABASE_URL:

```bash
node scripts/migrate-to-postgres.js
```

This script creates the required tables in Postgres. After that users created in the new DB will persist across deploys.

Notes
- If you switch from SQLite to Postgres, existing SQLite data will not be automatically migrated by this script. For full data migration, dump SQLite data and import into Postgres (I can help write a migration helper if you want).
- Keep `SESSION_SECRET` stable. Rotating it invalidates existing sessions.
