# Careflow Phase 3 — Local Setup

## Requirements

- Node.js **22.5+** (tested on Node 22; `node:sqlite` may print Node's expected experimental warning).
- npm 10+.
- No separately managed database service is required for local development.

## Start the API

In terminal 1:

```bash
cd backend
npm ci
cp .env.example .env
```

Edit `.env`: replace `JWT_SECRET` with a unique random secret of at least 32 characters; keep the API bound to loopback. Set `CORS_ORIGIN` to the exact browser origin used below (default `http://127.0.0.1:3000`). Then initialize and validate the relational database:

```bash
npm run db:migrate
NODE_ENV=development npm run db:seed
npm run db:verify
npm run dev
```

The API listens at `http://127.0.0.1:4000`. The default SQLite file is `backend/data/careflow.sqlite`; the development database is persistent across server restarts. Migrations are versioned and are not run automatically by the server. The deterministic seed is safe to repeat and does not overwrite an existing populated seed.

## Start the frontend

In terminal 2, from the project root:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. Vite proxies `/api` to the backend at `http://127.0.0.1:4000`; no clinic entities or preferences are persisted in browser storage. The browser retains only the JWT and minimal session identity metadata needed to restore authentication.

## Demo accounts

All seeded accounts use the synthetic local-development password `demo123`; credentials are stored only as bcrypt hashes. See [DEMO_DATA.md](./DEMO_DATA.md) for usernames, roles, scope and source provenance. Change credentials before any non-demo use.

## Database commands

From `backend/`:

```bash
npm run db:migrate  # Apply any pending schema migration
NODE_ENV=development npm run db:seed # Populate the synthetic seed if needed; repeat-safe
npm run db:verify   # SQLite integrity and foreign-key checks
NODE_ENV=development npm run db:reset # DESTRUCTIVE: rebuild and reseed this local DB
```

`db:reset` is only for local development/testing and replaces the selected database with synthetic seed data. To isolate tests or scratch work, set `DATABASE_PATH` in `.env` to another file (or `:memory:` where supported). Do not point it at any production or user-data database.

## Build and verification

```bash
# backend
cd backend
npm run build
npm test
npm audit

# frontend (separate terminal)
cd frontend
npm run typecheck
npm run build
npm audit
```

The backend suite uses isolated SQLite databases and synthetic data; no external service or deployment is required. See the project-root `FINAL_QA_REPORT.md` for the final UI walkthrough, security review, and test results.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `HOST` | `127.0.0.1` | Bind address; remains loopback by default |
| `JWT_SECRET` | A temporary process-random secret if unset | Set a unique 32+ character secret locally; never commit it |
| `CORS_ORIGIN` | `http://127.0.0.1:3000` | Exact allowed local frontend origin(s), comma-separated |
| `DATABASE_PATH` | `./data/careflow.sqlite` | SQLite file path, resolved from `backend/` |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed attempts before account lockout |
| `LOGIN_LOCK_MINUTES` | `15` | Lockout duration |

## API smoke check

```bash
curl -s http://127.0.0.1:4000/health
curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin01","password":"demo123"}'
```

The API returns a bearer token in `data.token`; use it with protected endpoints as `Authorization: Bearer <token>`.

## Scope and production note

This deliverable is a loopback-only Phase 4 implementation and handoff, **not a production deployment**. Demo seed and reset commands require explicit `NODE_ENV=development`; no service is configured to listen on a public address. Before live use, provision real secrets and data, define clinic timezone and retention, and select hosting, backups, and production database policy explicitly.
