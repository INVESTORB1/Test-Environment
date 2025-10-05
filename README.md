# Test Environment Prototype

Prototype for an invite-only test environment for novice testers.

Quick start (requires Docker + Docker Compose):

```powershell
# from project root
docker-compose up --build
```

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
