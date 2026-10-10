# Careflow Clinic ERP — Phase 4 Final QA

Phase 3 connects the verified Phase 1 Careflow interface to a persistent relational SQLite API. The verified source is `careflow (2).zip` (SHA-256: `7dad214f7745ba708eeb0d23d59a95b4fcbb3c58a79825370d11f2ae19638e70`); no older archive was used as authority. The app retains its existing page/route design, while authentication, API transport, reporting, exact INR accounting and selected workflow copy are integrated.

## Run locally

Use Node.js 22.5+ and keep both servers on loopback.

**Terminal 1 — backend:**

```bash
cd backend
npm ci
cp .env.example .env
# Edit JWT_SECRET to a private random value (32+ characters).
npm run db:migrate
NODE_ENV=development npm run db:seed
npm run db:verify
npm run dev
```

Set `CORS_ORIGIN=http://127.0.0.1:3000` in `backend/.env` to match the frontend origin.

**Terminal 2 — frontend:**

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The Vite development server proxies `/api` to Express. Seeded synthetic logins (password `demo123`) are listed in [DEMO_DATA.md](backend/DEMO_DATA.md). Do not expose these demo credentials beyond local testing.

## Contents

- `backend/`: Express/TypeScript API, normalized versioned SQLite migration, repositories, transactional workflows, deterministic seed/reset/verify CLI, and 35 integration/persistence tests.
- `frontend/`: the verified Phase 1 interface with API-backed JWT authentication and INR presentation.
- [Phase 3 handoff and verification](PHASE3_HANDOFF.md): schema, migration/seed behavior, INR boundaries, files changed, test results and limitations.
- [Final QA and security report](FINAL_QA_REPORT.md): final test/build/audit outcomes, manual UI walkthrough, findings and submission notes.
- [Backend setup](backend/SETUP_GUIDE.md), [database contract](backend/DATABASE_CONTRACT.md), [API contract](backend/FRONTEND_API_CONTRACT.md), and [synthetic demo data](backend/DEMO_DATA.md).

## Commands

```bash
# backend
cd backend && npm run build && npm test && npm audit
# frontend, from another terminal
cd frontend && npm run typecheck && npm run build && npm audit
```

Use `NODE_ENV=development npm run db:reset` only when you intentionally want to **replace the local SQLite file with synthetic seed data**. The reset guard requires the explicit development mode and the database path must never point to production data. The backend binds to `127.0.0.1` by default; deployment, public hosting, and production operations are not part of this deliverable.
