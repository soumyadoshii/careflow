# Phase 2 Implementation Notes

## Baseline and scope

- Authoritative Phase 1 archive: `careflow (2).zip` (SHA-256 `7dad214f7745ba708eeb0d23d59a95b4fcbb3c58a79825370d11f2ae19638e70`). The backend's typed seed mapping is copied from this archive. No older archive superseded it.
- Scope: backend only. No React/Vite source in this backend project was edited.
- Roles are the six roles in the baseline. Finance is a feature area, not a role.
- Appointment duration is 30 minutes, with half-hour starts 08:00–17:00 inclusive, matching the Phase 1 scheduling UI. Clinic timezone remains a Phase 3 deployment setting.
- Account lockout defaults to five failed attempts and a 15-minute lock.

## Deliberate choices

- SQLite storage is a development/test adapter; the logical Phase 3 normalized model is independently documented.
- `bcryptjs` creates interoperable bcrypt hashes without native-build problems. `node:sqlite` itself is built in.
- Login lockouts and JWT token version revocation are stored server-side.
- Appointment slot checks use the requested 30-minute duration from the baseline and are re-evaluated inside `BEGIN IMMEDIATE` approval transactions. SQLite serializes local writes; Phase 3 must use equivalent row/range locking or serializable isolation.
- New Admin-created user records receive a random temporary password when one is not supplied; the response shows temporary credentials once. Persistent storage contains only a bcrypt hash.
- `doctor03` is added as a local test login for Dr. Mei Tan, whose Doctor user is present in the Phase 1 seed but not in the requested account list. No extra role was introduced.
- `GET /api/reports/:kind?format=print` returns print-friendly HTML. CSV is an additional export. PDF is generated with PDFKit; XLSX is emitted as minimal OpenXML via fflate (no xlsx parser dependency).

## Integration boundary / unresolved items

- The frontend currently calls a localStorage-backed mock facade. It remains intact by instruction. Phase 3 must implement the HTTP adapter inside that existing facade, store the token according to the eventual client threat model, and map `setInvoicePayment(id, paid)`'s cumulative amount to an incremental payment `{amount: max(0, paid-currentPaid)}`.
- Frontend `reset()` is intentionally not available server-side; its current meaning is local synthetic browser data reset. A server-wide reset endpoint would be destructive and is not appropriate for an ordinary profile control.
- User creation through the Phase 1 generic user form has no username/password fields; the backend generates a username from email and one-time temporary password. The future facade should surface the returned temporary credentials to an authorized administrator without storing plaintext.
- Phase 1 permits medicine catalog form edits including stock; Phase 2 rejects stock changes through generic update and requires `/stock-adjustments`, dispensing, or receiving. This is an intentional backend integrity guard.
- Phase 1 invoice `setInvoicePayment` uses a cumulative `paid` amount, while the secure payment API is incremental and capped at outstanding balance. The mapping is documented; no frontend change was made.
- Tests use synthetic data and local SQLite only. No real PHI, external credentials, production database, hosting, or deployment is configured.
