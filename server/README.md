# LogiSource AI Office API + Worker

- PostgreSQL-backed employee registry, task queue, task runs, events and approvals.
- API binds to 127.0.0.1:3215. Nginx proxies /api/ from the existing HTTPS vhost.
- Nine employee seats are seeded, plus Alex as virtual supervisor (not in the employee picker).
- Worker claims queued work with PostgreSQL row locks and calls OpenAI Responses API server-side.
- Successful runs enter review. The Director must approve, request changes or reject.
- Worker has no shell, filesystem or publishing tools.

## Environment

Copy server/.env.example to /etc/ls-office/api.env and set DATABASE_URL, a long random LS_OFFICE_ADMIN_TOKEN, and OPENAI_API_KEY. Never expose these as Vite variables. The Director token is held in page memory only.

The initial bearer-token gate is suitable only for a restricted internal deployment. Before broad internet exposure, add proper user sessions, CSRF protection, token rotation, rate limiting and stronger reviewer identity.

## Install

Create a dedicated PostgreSQL role/database named ls_office; never reuse another application's database. Install Node dependencies, configure the environment file, install both systemd units, and add nginx-location.conf inside the existing HTTPS server block for office.febro.id. Run nginx -t before reloading.

Verify /api/health, authenticate in Command Center, create a test task and review the output. The API migrates schema and seeds employees at startup. Do not start the worker until the database, token and provider key are configured.
