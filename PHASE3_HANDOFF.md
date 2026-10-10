# Careflow Phase 3 Handoff

## Delivered and provenance

The integrated app uses the verified Phase 1 baseline `careflow (2).zip` only (SHA-256 `7dad214f7745ba708eeb0d23d59a95b4fcbb3c58a79825370d11f2ae19638e70`). Existing screens and route paths remain; the frontend now authenticates against the Phase 3 backend. No app was deployed or exposed publicly.

## Database and migration

- Local persistent SQLite via Node `node:sqlite`; migration runner at `backend/src/db/migrations.ts` applies versioned `001_initial` and records schema versions.
- `backend/src/db/migrations/001_initial.ts` creates typed relational tables: `patients`, `users`, `credentials`, `preferences`, `appointments`, `availability_blocks`, `consultations`, `prescriptions`, `suppliers`, `medicines`, `prescription_items`, `lab_orders`, `procurement_orders`, `procurement_items`, `invoices`, `invoice_items`, `invoice_payments`, `audit`, `notifications`, and `settings`.
- Foreign keys, status/role enums, unique identifiers, positive quantities, nonnegative stock/money, invoice balance bounds and exactly-one availability target are enforced in SQL; indexes cover scheduling, patient history, lab work queues, invoice and notification lookups, and audits. There is no JSON-document `records` table.
- `backend/src/repositories/recordRepository.ts` maps the legacy entity facade to typed tables. `backend/src/db/seed.ts` retains synthetic Phase 1 entities/IDs and stores bcrypt password hashes only.
- Commands: `npm run db:migrate`, `npm run db:seed` (repeat-safe), `npm run db:verify`, and `npm run db:reset` (destructive local-only reseed). Full startup instructions: `backend/SETUP_GUIDE.md`.

## Frontend/backend integration

- `frontend/src/lib/api/api.ts` is now a typed HTTP client that preserves the existing facade operations and unwraps API envelopes; Vite `/api` proxy target is configurable with `VITE_BACKEND_ORIGIN`.
- Username/password login, JWT-authenticated `/me`, logout, role identity and server-side patient ownership are used instead of the in-browser demonstration login. Browser storage is restricted to the JWT and minimal session identity; clinic records, reports and preferences are retrieved/persisted by the backend. The old local demo data store and copied frontend seed are removed.
- Existing screens keep their routes and layout. Patient appointment requests remain pending until Receptionist review. The actual local UI journey was exercised: Patient submits a request → Receptionist reviews both schedules → Receptionist approves/schedules → backend notifies Patient and Doctor. The local database was reset to a clean synthetic seed after the test.
- Financial screens and operational reports render successfully from the server. The preserved design is not otherwise redesigned.

## INR and exact money handling

- Durable database amounts are integer **paise**: examples include `unit_price_paise`, `total_paise`, `paid_paise`, line `amount_paise`, and payment `amount_paise`.
- `backend/src/domain/money.ts` and `frontend/src/lib/format.ts` parse decimal INR strings into paise with `BigInt`, check safe-integer bounds, and convert only at the API/display boundary. Line totals, invoice balances, dashboard and report aggregates use integer paise; invoice totals and payment status are server-calculated.
- All monetary UI formatting uses `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`; report exports include INR in JSON, CSV, XLSX/OpenXML, print HTML and PDF. A licensed Noto font with the rupee glyph is bundled with its copyright/license notice for PDF output.
- Tests assert INR/paise totals across raw CSV, XLSX XML, print and extracted PDF, including multi-line invoices and incremental payments.

## Verification

- Backend: `npm run build` passed; **20/20 tests passed**; `npm audit` reported **0 vulnerabilities**.
- Frontend: `npm run typecheck` and optimized Vite production build passed; `npm audit` reported **0 vulnerabilities** after upgrading the inherited React Router to the fixed 7.18.4 line.
- UI/browser verification: login, Patient appointment request, Receptionist queue/review/approval and booking confirmation; Billing and Operational Reports rendered with INR values and server data.
- Persistence verification: deterministic seed survived a separate-process restart and repeated seed remained idempotent; SQLite integrity and foreign-key checks passed on a disposable file.
- Node may display its expected experimental `node:sqlite` warning. This is informational, not a failed test.

## Changed/added files

**Integrated frontend (relative to the verified Phase 1 source):**

- Integration, auth and routing: `frontend/src/app/App.tsx`, `frontend/src/components/data/CrudPage.tsx`, `frontend/src/components/layout/AppShell.tsx`, `frontend/src/features/auth/LoginPage.tsx`, `frontend/src/lib/auth/session.ts`, `frontend/src/lib/api/api.ts`, `frontend/src/lib/api/types.ts`, new `frontend/src/lib/api/storeTypes.ts`, `frontend/src/lib/reports/types.ts`, and `frontend/vite.config.ts`.
- INR, reporting and workflows: `frontend/src/lib/format.ts`, `frontend/src/features/dashboard/DashboardPage.tsx`, `frontend/src/features/finance/FinancePages.tsx`, `frontend/src/features/inventory/InventoryPages.tsx`, `frontend/src/features/clinical/AppointmentWorkflow.tsx`, `frontend/src/features/clinical/ClinicalPages.tsx`, `frontend/src/features/patients/PatientPages.tsx`, `frontend/src/features/pharmacy/PharmacyPage.tsx`, `frontend/src/features/laboratory/LaboratoryPages.tsx`, `frontend/src/features/administration/AdminPages.tsx`, and `frontend/src/styles.css`.
- Removed local-only artifacts: `frontend/src/lib/storage/demoStore.ts`, `frontend/src/lib/reports/mockReports.ts`, and `frontend/src/data/seed.ts`. `frontend/TODO.md` is marked as a historical Phase 1 checklist so its mock-only requirements are not mistaken for current behavior. Frontend manifests/lockfiles were updated for the audited router fix; the dev server now defaults to loopback.

**Backend:**

- API/application: `backend/src/app.ts`, `backend/src/http.ts`, `backend/src/routes/api.ts`, `backend/src/server.ts`.
- Database/domain/services: `backend/src/db/database.ts`, `backend/src/db/migrations.ts`, `backend/src/db/migrations/001_initial.ts`, `backend/src/db/seed.ts`, `backend/src/db/cli.ts`, `backend/src/domain/money.ts`, `backend/src/domain/seed.ts`, `backend/src/domain/types.ts`, `backend/src/repositories/recordRepository.ts`, and `backend/src/services/workflows.ts`.
- Validation/docs/deps/assets: `backend/test/api.test.ts`, `backend/test/persistence.test.ts`, backend package files and `.env.example`, the bundled `backend/assets/NotoSansDevanagari-Regular.ttf` and `backend/assets/NOTO_FONTS_COPYRIGHT.txt`, plus `backend/README.md`, `backend/SETUP_GUIDE.md`, `backend/DATABASE_CONTRACT.md`, `backend/FRONTEND_API_CONTRACT.md`, and `backend/DEMO_DATA.md`.

Project-level `README.md` and this handoff are new.

## Remaining scope / limitations

No blocker remains for the requested local Phase 3 deliverable. This is a local Node/SQLite reference implementation, not a production deployment or clinical-use certification. Live operation still needs explicit hosting/network, backup/restore, retention/privacy, clinic-timezone, monitoring and security review decisions. Synthetic `demo123` credentials are for local demonstration only; replace them before any non-demo use. The React Router security advisories found during review were resolved, and both dependency audits are clean.