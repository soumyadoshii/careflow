# Careflow Phase 3 Demo Data

## Provenance

The seed data is mapped from `src/data/seed.ts` inside the verified `careflow (2).zip` Phase 1 baseline. The archive SHA-256 used during this build is `7dad214f7745ba708eeb0d23d59a95b4fcbb3c58a79825370d11f2ae19638e70`. Existing identifiers, role labels, patient/doctor names, appointment history, medicines, suppliers, invoices, lab orders, and notifications are retained. The verified frontend source is integrated in `../frontend/`; its Phase 1 page and route design remains the baseline.

## Demo accounts

All seeded password credentials are bcrypt hashes. Local development password is `demo123`.

| Username | Seed user | Role | Notes |
|---|---|---|---|
| `admin01` | Alex Morgan (`usr-admin`) | Clinic Administrator | User administration, audit and settings |
| `receptionist1` | Nina Patel (`usr-reception`) | Receptionist | Patient management, appointment scheduling and approval, permitted billing |
| `doctor01` | Dr. Omar Hassan (`usr-doctor`) | Doctor | General Medicine; assigned existing patient workflows |
| `doctor02` | Dr. Elise Carter (`usr-doctor-elise`) | Doctor | Cardiology |
| `doctor03` | Dr. Mei Tan (`usr-doctor-mei`) | Doctor | Local convenience account for the third doctor already present in the Phase 1 seed |
| `pharmacist1` | Grace Lin (`usr-pharmacist`) | Pharmacist | Prescriptions and inventory |
| `labtech1` | Ethan Brooks (`usr-lab`) | Laboratory Technician | Laboratory worklist and results |
| `patient1` | Riya Nair (`usr-patient-demo`, `pat-1042`) | Patient | Own profile and released records only |
| `patient2` | Daniel Kim (`usr-patient-2`, `pat-1043`) | Patient | Own profile and released records only |
| `patient3` | Aisha Rahman (`usr-patient-3`, `pat-1044`) | Patient | Own profile and released records only |
| `patient4` | Mateo Rivera (`usr-patient-4`, `pat-1045`) | Patient | Own profile and released records only |
| `patient5` | Noor Siddiqui (`usr-patient-5`, `pat-1046`) | Patient | Own profile and released records only |

`doctor03` is an additional local credential to make the third seeded Doctor identity testable; it does not introduce a new role. The six roles are exactly those of the Phase 1 baseline.

## Seeded entities

The database seed preserves Phase 1 IDs and synthetic values for ten patient records (`pat-1042` through `pat-1051`), appointments (`apt-2401` through `apt-2414`), availability blocks (`avb-101`, `avb-102`), consultations (`con-701` through `con-703`), prescriptions (`rx-5501` through `rx-5506`), lab orders (`lab-3101` through `lab-3107`), medicines (`med-101` through `med-110`), suppliers (`sup-01` through `sup-04`), procurement (`po-801` through `po-804`), invoices (`inv-9201` through `inv-9208`), user records, audit events, notifications, and clinic settings. Values are synthetic/test data only.

## Scenarios covered by tests

1. Login, role derived from signed JWT, `/auth/me`, logout invalidation, password change, and failed-login lockout.
2. Patient ID spoofing is ignored; a Patient cannot read another patient's profile or clinical information.
3. Patient, Doctor, and Receptionist-created requests start as `Pending Approval`; Receptionist-created requests use persisted active patient records, and approval is still required before scheduling.
4. Patient and Doctor conflicts and availability blocks prevent approval. The approval transaction checks availability again.
5. Two simultaneous requests consuming the same Doctor/time slot result in exactly one successful approval.
6. Receptionist time proposals remain pending, require affected Patient/Doctor acceptance, then require final Receptionist approval.
7. Rejection, cancellation request/finalization, allowed state transitions, audit and notification events.
8. Prescription stock shortage makes no partial deductions; successful dispensing deducts all items and rejects duplicate dispensing.
9. Procurement receive updates stock once and rejects duplicate receive.
10. Invoice payment rejects negative values and overpayment and calculates invoice status on the server.
11. Laboratory status transitions and result-release rules.
12. JSON/CSV/report access control and admin-only audit visibility.

For reproducible setup see `SETUP_GUIDE.md`. Apply `npm run db:migrate`, then `npm run db:seed`; the seed is repeat-safe. `npm run db:reset` is deliberately destructive and only for a local synthetic database.
