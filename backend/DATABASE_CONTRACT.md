# Careflow Database Contract — Phase 3 Handoff

## Purpose and boundary

This contract describes the **implemented Phase 3 relational schema**, derived from the verified Phase 1 entities and Phase 2 workflow semantics. The local reference backend uses persistent SQLite through Node `node:sqlite`, with a replaceable repository and versioned migrations. It no longer uses a JSON-document records table. This is a local Phase 3 implementation—not a production deployment or certification; production hosting, backups, retention, timezone and database policy remain explicit operational decisions.

The physical schema is created by `src/db/migrations/001_initial.ts` and versioned by `src/db/migrations.ts`. It includes typed patient, user/credential, scheduling, clinical, pharmacy, laboratory, procurement, billing, audit, notification, preference and settings tables. The exact physical names and paise columns are summarized in the Phase 3 project [handoff](../PHASE3_HANDOFF.md).

Phase 3 preserves Phase 1 string IDs and stores dates/times in text/ISO-compatible form. Appointment dates/times are clinic-local values; a live deployment must select a clinic timezone. Financial values are **integer paise** in storage and are converted at the API/display boundary. Enforce foreign keys, parameterized SQL and the transactional workflow invariants below.

## Logical entities and fields

| Logical entity (physical table names are listed in the Phase 3 handoff) | Fields and types | Relationships / constraints |
|---|---|---|
| User / `users` | `id TEXT PK`; `username TEXT`; `name TEXT`; `email TEXT`; `role ENUM`; `department TEXT`; `status ENUM(Active,Inactive)`; `last_active_at TIMESTAMP`; `patient_id TEXT NULL FK`; created/updated timestamps | Unique case-insensitive username and normalized email as clinic policy allows. `patient_id` is unique when present and only valid for Patient role. Never store password in this row. Exactly six roles: Clinic Administrator, Receptionist, Doctor, Pharmacist, Laboratory Technician, Patient. |
| Credential / `user_credentials` | `user_id TEXT PK/FK`; `password_hash TEXT`; `failed_attempts INTEGER`; `locked_until TIMESTAMP NULL`; `token_version INTEGER`; password-updated timestamp | One-to-one User. Unique username may live here if desired. Store bcrypt hashes only; never return them. Auth must hydrate role/ownership from current User row. |
| Patient / `patients` | `id TEXT PK`; `mrn TEXT`; `name TEXT`; `date_of_birth DATE`; `sex ENUM(Female,Male,Other)`; `phone TEXT`; `email TEXT NULL`; `blood_group TEXT NULL`; `emergency_contact TEXT`; `registered_at DATE`; `last_visit DATE NULL`; `status ENUM(Active,Inactive)` | `mrn` unique. Patient may link to exactly one user account. No hard delete when referenced; archive/deactivate. |
| Appointment / `appointments` | `id TEXT PK`; `patient_id FK`; `doctor_id FK users`; `provider_snapshot TEXT`; `department TEXT`; `date DATE`; `time TIME`; `requested_date DATE`; `requested_time TIME`; `confirmed_date/time NULL`; `proposed_date/time NULL`; `type TEXT`; `reason TEXT`; `requested_by_user_id FK`; `requested_by_name_snapshot TEXT`; `requested_by_role ENUM`; `status ENUM`; `approved_by_user_id FK NULL`; `rejection_reason/cancellation_reason TEXT NULL`; cancellation/reschedule request actor+timestamp; proposal actor/acceptor+timestamps; created/updated timestamps | Patient and Doctor FKs required. Requested/proposed/confirmed time are distinct because proposal acceptance must precede receptionist confirmation and an existing confirmed booking remains intact during a reschedule. Optional composite/partial uniqueness can prevent same doctor slot for exact-slot clinics, but overlap checking remains a transactional service invariant. Keep actor snapshots for historical presentation. |
| Availability block / `availability_blocks` | `id TEXT PK`; `target_type ENUM(Patient,Doctor)`; `target_id TEXT` (typed FK to Patient or User); `date DATE`; `start_time TIME`; `end_time TIME`; `reason TEXT`; `active BOOLEAN`; `created_by_user_id FK`; created timestamp | Require `start_time < end_time`; index active blocks by target/date. Receptionist/Admin can create blocks for clinic participants; Patient/Doctor can only create or change their own. The implementation uses nullable `patient_id` and `doctor_id` FKs plus an exactly-one-target check, avoiding an unenforced polymorphic target. |
| Consultation / `consultations` | `id TEXT PK`; `appointment_id FK`; `patient_id FK`; `doctor_id FK`; `provider_snapshot TEXT`; `reason TEXT`; `notes TEXT`; `status ENUM(Waiting,In Progress,Completed)`; `date DATE`; created/updated timestamps | Tie patient and doctor to appointment; optionally unique appointment if one consultation per visit. Doctor edits only assigned appointment; Receptionist has no clinical edit rights. |
| Prescription / `prescriptions` | `id TEXT PK`; `patient_id FK`; `doctor_id FK`; `provider_snapshot TEXT`; `date DATE`; `status ENUM(Pending,Ready for Pickup,Dispensed,Cancelled)`; `dispensed_by_user_id FK NULL`; `dispensed_at TIMESTAMP NULL`; created/updated timestamps | Patient and prescribing Doctor FKs. The existing Phase 1 `items` array is normalized into Prescription Item. Doctor owns authoring; Pharmacist owns dispensing; Patient reads own. |
| Prescription item / `prescription_items` | `id TEXT PK`; `prescription_id FK`; `medicine_id FK`; `dose TEXT`; `quantity INTEGER`; `instructions TEXT`; optional unit snapshot | Quantity must be positive integer; indexes on prescription and medicine. Decrement stock only in dedicated atomic dispense transaction. |
| Lab order / `lab_orders` | `id TEXT PK`; `patient_id FK`; `ordered_by_user_id FK` (Doctor); `test TEXT`; `ordered_at DATE`; `priority ENUM(Routine,Urgent)`; `assigned_to_user_id FK NULL` (Lab Technician); `status ENUM(Ordered,Collected,Processing,Completed,Reviewed)`; `result TEXT NULL`; `reference_range TEXT`; result/review actor+timestamps | Status progresses in order. Require result before Completed. Patient can see only released/Reviewed results; Doctor sees relevant results; Lab Technician updates workflow; Receptionist cannot edit results. |
| Medicine / `medicines` | `id TEXT PK`; `code TEXT`; `name TEXT`; `form TEXT`; `strength TEXT`; `stock INTEGER`; `minimum_stock INTEGER`; `expiry DATE`; `supplier_id FK`; `unit_price_paise INTEGER`; `active BOOLEAN`; created/updated timestamps | Code unique. `stock >= 0`, `minimum_stock >= 0`, price ≥ 0. Client never sets stock except through dedicated, audited adjustment and transactional dispensing/receiving. |
| Supplier / `suppliers` | `id TEXT PK`; `name TEXT`; `contact TEXT`; `phone TEXT`; `email TEXT`; `lead_days INTEGER`; `status ENUM(Active,Inactive)`; created/updated timestamps | Supplier may be referenced by medicines/orders; deactivate rather than delete when referenced. |
| Procurement order / `procurement_orders` | `id TEXT PK`; `supplier_id FK`; `created_at DATE`; `expected_at DATE`; `status ENUM(Draft,Submitted,Approved,Received,Cancelled)`; `total_paise INTEGER` (calculated); received actor/time; created/updated timestamps | Receiving only from Submitted/Approved and exactly once. Phase 1 array is normalized into Procurement Item. |
| Procurement item / `procurement_items` | `id TEXT PK`; `procurement_id FK`; `medicine_id FK`; `quantity INTEGER`; `unit_price_paise INTEGER` snapshot | Positive quantity; index procurement and medicine. Calculate total server-side. No client-set totals or stock updates. |
| Invoice / `invoices` | `id TEXT PK`; `patient_id FK`; `issued_at DATE`; `due_at DATE`; `description TEXT`; `total_paise INTEGER`; `paid_paise INTEGER`; `status ENUM(Unpaid,Part Paid,Paid,Void)`; void actor/time; created/updated timestamps | Require total ≥ 0 and 0 ≤ paid ≤ total. Status derived from server values. Patient reads own; Receptionist/Admin manage. The implementation stores append-only payment entries in the separate `invoice_payments` table. |
| Invoice payment / `invoice_payments` | `id TEXT PK`; `invoice_id FK`; `amount_paise INTEGER`; `method TEXT NULL`; `reference TEXT NULL`; `recorded_by_user_id FK`; `recorded_at TIMESTAMP` | Amount non-negative and no greater than current outstanding amount within a serializable/locked transaction; append-only. Payment is not a card processor integration. |
| Notification / `notifications` | `id TEXT PK`; `recipient_user_id FK`; `role_snapshot ENUM`; `patient_id FK NULL`; `title TEXT`; `message TEXT`; `created_at TIMESTAMP`; `href TEXT`; `read_at TIMESTAMP NULL` | Recipient-scoped reads and mark-read. Do not broadcast PHI through broad role audiences. |
| Audit event / `audit_events` | `id TEXT PK`; `actor_user_id FK NULL`; `actor_name_snapshot TEXT`; `role_snapshot TEXT`; `action TEXT`; `entity_type TEXT`; `entity_id TEXT`; `occurred_at TIMESTAMP`; `details TEXT`; `metadata JSON` | Append-only; no API to mutate/delete; add indexes by entity, actor, and time. Each important multi-record operation creates its audit row in the same transaction. |
| System setting / `system_settings` | `id TEXT PK`; `label TEXT`; `value TEXT`; `description TEXT`; updated actor/time | Admin only. Enforce unique setting key/label per Phase 3 conventions. |
| User preference / `user_preferences` | `user_id TEXT PK/FK`; `date_format ENUM`; `compact_tables BOOLEAN`; updated timestamp | Per-user UI preferences; not authorization state. |

## Status enums and mappings

- Appointment: `Pending Approval`, `Approved` (legacy Phase 1 data only), `Scheduled`, `Checked In`, `In Consultation`, `Completed`, `Cancelled`, `Rejected`, `No Show`, `Reschedule Requested`.
- Consultation: `Waiting`, `In Progress`, `Completed`.
- Prescription: `Pending`, `Ready for Pickup`, `Dispensed`, `Cancelled`.
- Lab: `Ordered`, `Collected`, `Processing`, `Completed`, `Reviewed`.
- Procurement: `Draft`, `Submitted`, `Approved`, `Received`, `Cancelled`.
- Invoice: `Unpaid`, `Part Paid`, `Paid`, `Void` (not the global generic Phase 1 Status union).
- Phase 1 `AvailabilityBlock.targetType/targetId` maps to either patient or doctor FK.
- Phase 1 nested `Prescription.items[]` maps to rows in `prescription_items`; `ProcurementOrder.items[]` maps to `procurement_items`.
- Phase 1 appointment requested/proposed/confirmed values map to separate columns; do not collapse into one `date/time` pair.
- Phase 1 `AuditEvent.actor` and role/action/area/recordId/details map to actor FK plus immutable name/role snapshots and entity fields.
- Phase 1 `NotificationRecord.role/recipientId/patientId` maps to a concrete `recipient_user_id` plus optional patient context; avoid role-only broad PHI delivery.

## Required indexes and constraints

1. Unique normalized `users.username`; unique `patients.mrn`; unique medicine code; unique Patient user linkage when non-null.
2. Foreign keys for appointments, consultations, prescriptions/items, labs, suppliers, procurement/items, invoices/payments, notification recipients, audit actors, and preferences.
3. Appointment indexes `(doctor_id,date,status,time)` and `(patient_id,date,status,time)`; availability index `(target_type,target_id,date,active,start_time,end_time)`; preserve overlapping-time conflict service checks.
4. Patient search indexes suitable for normalized MRN/name/phone; lab/prescription/invoice indexes by patient and date/status; audit `(occurred_at,entity_type,entity_id)`; notification `(recipient_user_id,read_at,created_at)`.
5. Stock, quantity, and monetary checks: nonnegative stock, positive line quantities, valid totals, payments never exceeding outstanding in a transaction.
6. Soft archive for referenced patients, users, medicines, and suppliers; audit and payment history append-only.

## Transactional invariants (mandatory in Phase 3)

- **Appointment approval:** serializable/locked operation; reload Pending Approval, verify Receptionist, recheck both party appointment overlaps and both availability-block sets, update confirmed date/time/status/approver, add audit and notifications, then commit. Roll back all on any failure. Concurrency test must prove a same-Doctor overlapping slot is approved at most once.
- **Rescheduling:** availability-check proposed time; require requester acceptance when this is the UI workflow; leave old confirmed time untouched until acceptance and Receptionist approval; notify affected parties.
- **Prescription dispense:** lock prescription and medicine stock rows; verify eligible state and every line quantity before any decrement; atomically decrement all, mark dispensed, add audit; no negative stock.
- **Procurement receive:** lock order; verify Submitted/Approved and not already received; validate all items, increment all stocks, mark Received, audit, commit. A duplicate receive changes nothing.
- **Invoice payment:** lock invoice; reject Void; amount ≥ 0 and ≤ outstanding; append payment; update paid amount and derived status; audit in same transaction.
- **User status/role/password changes:** invalidate token version in the same transaction; password must be bcrypt-hashed before storage.

## Ownership and privacy invariants

- Patient identity always resolves from authenticated User.patient_id. A Patient may not supply or override patient IDs.
- Doctor identity resolves from authenticated user; a Doctor only accesses patients/appointments tied to legitimate assigned clinical workflow.
- Receptionist manages scheduling/patient demographics/approved billing operations but has no unrestricted consultation, prescription, or lab-result access.
- Pharmacist access is limited to prescription fulfillment and inventory/procurement workflow; Lab Technician access is limited to lab workflow.
- Every endpoint rechecks role and record ownership; frontend navigation is not an authorization control.
- Phase 3 must apply tenant/clinic boundary predicates to every query if multi-clinic operation is introduced.
