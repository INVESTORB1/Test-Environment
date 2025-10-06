# Test Environment Prototype

Prototype for an invite-only test environment for novice testers.

Quick start (requires Docker + Docker Compose):

```powershell
# from project root
docker-compose up --build
```

## Persistence & local dev with Redis

See `README-PERSISTENCE.md` for a small docker-compose stack that runs Redis and persists the app data directory. Use it to test session persistence and keep the SQLite DB between restarts.
Open http://localhost:3000 and go to /admin to create an invite. The prototype shows the magic link on screen (no email sending).

Admin login: the admin UI is protected. For the prototype the admin password defaults to `admin`.
You can set a stronger password with the `ADMIN_PASSWORD` environment variable (e.g. in `docker-compose.yml` or your shell).

Email (magic links):
- To enable sending magic links over email, set the following environment variables:
	- `SMTP_HOST` - SMTP server host
	- `SMTP_PORT` - SMTP port (default 587)
	- `SMTP_USER` / `SMTP_PASS` - optional auth credentials
	- `SMTP_SECURE` - set to `true` to use TLS
	- `SMTP_FROM` - optional from address

If SMTP is not configured the prototype falls back to showing the magic link on-screen.

Seed templates (optional):
If you want the demo bank templates pre-populated, run the seed script after creating the `data` directory:

```powershell
mkdir data
node scripts/seed-templates.js
npm start
```

The seed script inserts a few sample bank templates (Alice, Bob, Carol). After that, visiting `/bank` will copy templates into your session sandbox automatically.
