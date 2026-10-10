# Careflow Clinic ERP — Phase 4 Final QA & Security Report

**Review date:** 3 October 2026  
**Result:** **QA pass for the local submission build**; this is not a production deployment or certification.

## Scope and baseline

This review completed final regression testing, an authenticated browser walkthrough, source-level security checks, dependency audits, database integrity checks, and submission preparation. It continued from the Phase 3 integrated source tree and preserved the Phase 1 UI and established business workflows. The verified Phase 1 reference remains `careflow (2).zip` (SHA-256: `7dad214f7745ba708eeb0d23d59a95b4fcbb3c58a79825370d11f2ae19638e70`); no older archive was treated as authoritative.

No new features or UI redesigns were introduced.

## Final verification results

| Area | Outcome |
|---|---|
| Backend clean install | `npm ci` succeeded |
| Backend build | `npm run build` succeeded |
| Backend tests | **35 passed, 0 failed, 0 skipped** |
| Backend dependency audit | **0 vulnerabilities reported** |
| Frontend clean install | `npm ci` succeeded |
| Frontend typecheck | `npm run typecheck` succeeded |
| Frontend production build | `npm run build` succeeded |
| Frontend dependency audit | **0 vulnerabilities reported** |
| SQLite integrity | `integrity_check: ok`; **0 foreign-key violations**; 2 migrations applied |
| Database CLI | Migration, explicit-development seed/reset, and verification all passed on a disposable temporary database |
| CORS smoke check | `http://127.0.0.1:3000` accepted; an unlisted origin received no `Access-Control-Allow-Origin` header |
| Local API/UI smoke check | API health endpoint returned success; Vite UI returned HTTP 200 |

The backend emits Node's expected `node:sqlite` experimental warning under the tested Node 22 runtime; this is not a failing test. npm also reports that the current Recharts 2.x line is deprecated/unsupported; it did **not** report a vulnerability.

## Test coverage

The 35-test suite covers authentication and login lockout; JWT logout/password changes; the exact six server-enforced roles; Patient ownership and immutable patient linkage; appointment approval, rescheduling, availability, time conflicts, cancellation and notifications; consultations; laboratory assignment and release transitions; atomic prescription dispensing and stock reconciliation; procurement receiving/idempotency; invoice totals and payment validation in integer paise; CSV/report behavior; user creation and password non-disclosure; per-recipient notifications; SQLite migrations, constraints and process-restart persistence; repeat-safe seeding; and protected demo reset behavior.

The final run included a regression test that invokes the **npm seed and reset scripts with `NODE_ENV=production`**, confirms both refuse to run, and confirms they do not create demo patient data.

## Manual UI walkthrough

Signed in with a documented synthetic local admin account and inspected the Dashboard, Appointments, Prescriptions, Laboratory Worklist, Pharmacy, Procurement, Billing, Financial Reports, and User Administration screens. The pages loaded authenticated backend data, exposed expected role/workflow actions, displayed rupee-denominated financial values, and showed the intended synthetic-demo/backend-auth context. **No user-facing “mock” or “browser-local” labels were present.** The UI’s `localStorage` use is limited to the JWT and minimal session identity metadata; clinic records and preferences remain server-backed. The walkthrough was read-only apart from the expected authentication audit event.

## Issues found and corrected

1. **Medicine archive test contract:** the API intentionally returns `204 No Content`; the prior test incorrectly expected `200` and an inline response body. The test now asserts `204`, performs a follow-up read, and verifies the medicine remains archived (`active=false`) with stock unchanged.
2. **Demo CLI environment override:** npm seed/reset wrappers previously forced `NODE_ENV=development`, which could bypass the CLI’s production-mode guard when the caller supplied `NODE_ENV=production`. The wrappers now preserve the caller’s environment. Synthetic seed/reset require explicit `NODE_ENV=development`; a regression test verifies production-mode refusal.
3. **Frontend port/CORS mismatch:** setup documentation referenced port 5173 while Vite is configured for loopback port 3000. README, setup instructions, `.env.example`, and the API’s default CORS origin now consistently use `http://127.0.0.1:3000`.
4. **Persisted ownership and workflow safeguards:** final regression coverage confirms immutable Patient linkage, stable user-ID ownership/assignment, authorization checks, per-recipient notification state, formula-safe exports, atomic stock/payment operations, and prevention of future-dated No Show transitions.

## Security review

- Authentication uses bcrypt password hashes and bearer JWTs; the app enforces session version/expiry and server-side lockout behavior. Login failures remain generic.
- The authoritative role set is exactly **Clinic Administrator, Receptionist, Doctor, Pharmacist, Laboratory Technician, and Patient**. There is no Finance role; financial screens/actions use the specified roles.
- Authorization and record ownership are enforced by the API rather than relying on navigation visibility. Patient account linkage is immutable through the user-management workflow.
- SQL values use prepared-statement parameters. Dynamic table identifiers are drawn from a static collection-to-table allowlist; record collection names are validated before use.
- Export injection protections, critical workflow transactions, and database constraints are covered by regression tests.
- Source scans found no embedded service-key/private-key patterns, unsafe DOM HTML injection APIs, or `eval` use. No direct logging of passwords, tokens, or request bodies was found in the reviewed auth/error paths. Unexpected server exceptions return a generic API error; server logs contain the exception message only.
- `npm audit` reported zero vulnerabilities in both installed dependency trees.

## Scope limitations and production follow-up

- The deliverable is **loopback-only local software**, not a hosted production service. No real patient information was used; seeded data and the `demo123` credentials are synthetic and must not be reused for live operation.
- Before production use, provision real credentials and a strong persistent `JWT_SECRET`, configure secure hosting/TLS, backups and restore drills, monitoring, retention, and operational access policy. The browser currently stores its bearer token in `localStorage`; production deployment should pair that choice with strong XSS controls/CSP or evaluate an HTTP-only secure-cookie session.
- The reset command is destructive by design. Use it only against a disposable local development database and only with explicit `NODE_ENV=development`; never point `DATABASE_PATH` at production or user data.
- Load/performance testing, production hosting, backup/restore operations, and live-data migration were outside this final local QA scope.
- Recharts 2.x generated a deprecation notice despite the clean security audit; plan a compatible upgrade as a maintenance item.

## Reproduction commands

From the project root, use separate terminals:

```bash
# Backend
cd backend
npm ci
cp .env.example .env
# Set a unique JWT_SECRET (32+ random characters) in .env.
npm run db:migrate
NODE_ENV=development npm run db:seed
npm run db:verify
npm run dev
```

```bash
# Frontend
cd frontend
npm ci
npm run dev
# Open http://127.0.0.1:3000
```

```bash
# Verification
cd backend && npm run build && npm test && npm audit
cd ../frontend && npm run typecheck && npm run build && npm audit
```

For a deliberate local-only reset, run `NODE_ENV=development npm run db:reset` from `backend/` after confirming `DATABASE_PATH` points to a disposable development database.
