# Careflow Clinic ERP — Phase 3 Backend

This is the persistent relational backend integrated with the Phase 1 interface in `../frontend/`. The authoritative frontend provenance is the verified `careflow (2).zip` archive documented in the [project README](../README.md). The app has not been deployed or published.

## Architecture

Node.js 22.5+, Express 5, TypeScript, bcryptjs, JWT, Zod and built-in `node:sqlite` power the local API. `src/app.ts` composes the Express app; `src/routes/api.ts` owns REST controllers; `src/http.ts` handles shared auth/errors; `src/db/migrations.ts` applies versioned schema migrations; `src/db/migrations/001_initial.ts` defines typed relational tables; `src/repositories/recordRepository.ts` maps entities to SQL; and `src/services/workflows.ts` contains the critical transactional operations. The database is persistent local SQLite, not JSON documents.

## Main routes and workflows

- Auth/profile: login, logout, authenticated identity, password and preferences.
- Clinic collections: patients, appointments, consultations, prescriptions, lab orders, medicines, suppliers, procurement, invoices, notifications, users, audits and settings—with server-side role/ownership checks.
- Appointment workflow: request → pending review → availability-aware Receptionist approval/scheduling, rejection, cancellation, proposal/acceptance and status transitions.
- Transactional operations: dispense stock, receive procurement and record incremental invoice payments; financial totals/statuses and medicine stock are server-owned.
- Reports: JSON, CSV, PDF, XLSX/OpenXML and print HTML. Financial exports use INR/paise values.

See [FRONTEND_API_CONTRACT.md](./FRONTEND_API_CONTRACT.md) for the complete UI facade mapping, [DATABASE_CONTRACT.md](./DATABASE_CONTRACT.md) for schema/constraints, [DEMO_DATA.md](./DEMO_DATA.md) for local seed accounts and [SETUP_GUIDE.md](./SETUP_GUIDE.md) for run/reset commands.

## Security and local scope

Passwords are stored as bcrypt hashes. JWT role and patient ownership resolve from server-side user records, not request payloads. Login lockout and token-version invalidation are implemented. Clinic data is not persisted in browser localStorage; the frontend stores only authentication/session data and fetches clinic entities from this API. Both API and Vite development server default to loopback. Replace synthetic demo credentials before any non-demo use.

## Validation

`npm run build` passed; **20 integration and persistence tests passed**; `npm audit` reported **0 vulnerabilities**. The tests cover auth/lockout, roles and ownership, appointment concurrency/availability/notification flows, transactional pharmacy/procurement/billing, labs, reports/exports, normalized schema and persistent/idempotent seeding. The integrated frontend typecheck, production build and dependency audit also pass; see the [Phase 3 handoff](../PHASE3_HANDOFF.md). Node may display the expected experimental `node:sqlite` warning.

## Local setup

Use `npm ci`, copy `.env.example` to `.env`, set a private JWT secret and matching loopback CORS origin, then run `npm run db:migrate`, `npm run db:seed`, `npm run db:verify` and `npm run dev`. Start the frontend separately. `npm run db:reset` is a destructive local-only reseed. **This project is a local Phase 3 deliverable, not production hosting or deployment.**