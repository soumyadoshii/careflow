# Careflow Phase 1 → Phase 3 Frontend/API Contract

This contract is derived from the verified `careflow (2).zip` baseline (`src/lib/api/types.ts`, `src/lib/api/api.ts`, route tree, and feature call sites). Phase 3 preserves the existing routes and UI structure while replacing the API facade internals with a JWT-authenticated HTTP client; see `../frontend/src/lib/api/api.ts`. The local API base URL is `http://127.0.0.1:4000/api` (the Vite proxy forwards `/api`).

## Envelope, authentication, and errors

Every JSON success uses `{ "success": true, "data": ..., "meta": ...? }`. Collection responses are arrays in `data`; `meta` carries `{ page, pageSize, total }`. Errors use `{ "success": false, "error": { "code": "...", "message": "..." } }`. List failures are 401/403; missing IDs are 404; invalid values are 422; workflow conflicts and duplicate actions are 409. Stack traces and SQL details are never returned.

After `POST /auth/login`, send `Authorization: Bearer <token>` on all protected requests. Identity, role, and patient ownership always come from the verified server-side token and user record, not request body fields. Tokens expire after eight hours; logout and password change increment a server-side token version and invalidate existing tokens.

| Phase 1 facade method / usage | HTTP method and endpoint | Request / response mapping | Authentication and roles | Main errors |
|---|---|---|---|---|
| Login page (login operation) | `POST /auth/login` | `{username,password}` → `{token,tokenType,expiresIn,user}` | Public | 401 generic invalid-credentials; repeated failures lock account |
| `getSession` / current identity | `GET /auth/me` | Returns `{userId,name,role,patientId?,department}` | Authenticated | 401 |
| Logout | `POST /auth/logout` | Invalidates the user token version | Authenticated | 401 |
| Profile page | `GET /profile` | Returns safe authenticated profile | Authenticated | 401 |
| Profile password change | `PUT /profile/password` | `{currentPassword,newPassword}`; new password ≥10 chars; returns reauthentication requirement | All roles | 401 current-password invalid; 422 invalid password |
| `getPreferences` | `GET /profile/preferences` | Returns `{dateFormat,compactTables}` | All roles | 401 |
| `updatePreferences` | `PATCH /profile/preferences` | `{dateFormat?,compactTables?}` | All roles | 422 invalid preference |
| `list(collection)` | `GET /{collection}` | Returns role-filtered entity array; optional `q,status,sortBy,order,page,pageSize` | Resource-specific matrix below | 401/403/404/422 |
| `create(collection, input)` | `POST /{collection}` | Entity JSON. Server creates/normalizes security- and workflow-owned fields. Appointment requests use the special endpoint below. | Resource-specific | 403/409/422 |
| `update(collection,id,patch)` | `PUT /{collection}/{id}` | Partial entity patch, allowlisted by resource. Appointment state, paid balance, and stock cannot be set here. | Resource-specific | 403/404/409/422 |
| `archive(collection,id)` | `DELETE /{collection}/{id}` | Soft-archives/deactivates supported resources. Invoices are voided, not deleted. | Admin/receptionist or Admin/pharmacist by resource | 204; 403/404 |
| `getSnapshot` | `GET /dashboard/snapshot` | Role-scoped aggregate with Phase 1 collection names | Authenticated; each collection is independently permission-filtered | 401 |
| `getDashboardSnapshotForSession` | `GET /dashboard/snapshot` | Same role-scoped snapshot; no browser-supplied session is trusted | Authenticated | 401 |
| `listAppointmentsForSession` | `GET /appointments` | Filtered appointment array | Admin, Receptionist, assigned Doctor, owning Patient | 403/404 |
| `listAppointmentPatients` | `GET /patients` | Role-filtered patients needed by appointment UI | Authenticated; Patient gets own profile, Doctor/Lab/Pharmacist are care-scoped | 403 |
| `listActiveDoctors` | `GET /users/doctors` | Redacted active Doctor records (`id,name,role,department,status`) | Authenticated roles; never includes credentials | 401 |
| `listAvailabilityBlocksForSession` | `GET /availabilityBlocks` | Role-scoped block list | Admin/Receptionist; own Doctor/Patient blocks | 403 |
| `getAppointmentDashboardSummary(today)` | `GET /appointments/dashboard-summary?today=YYYY-MM-DD` | `{pendingCount,todayConfirmedCount,todayBlocksCount,conflictingRequestsCount,todayAppointments,pendingRequests}` | Authenticated; scope follows identity | 422 invalid date |
| `requestAppointment(input)` | `POST /appointments` | `{doctorId?,patientId?,department?,requestedDate,requestedTime,type,reason}` → appointment with `Pending Approval` | Patient or Doctor. Patient ID is derived from auth. Doctor identity is derived from auth. | 403/409/422 |
| `checkAppointmentAvailability(input)` | `GET /appointments/availability/check?...` | Query: `patientId,doctorId,date,time,excludeAppointmentId?` → `{time,canSchedule,patientConflict,doctorConflict,message}` | Receptionist/Admin | 403/409/422 |
| `findAvailableAppointmentSlots(input)` | `GET /appointments/availability/slots?...` | Query: `patientId,doctorId,date,excludeAppointmentId?` → open half-hour slots | Receptionist/Admin | 403/422 |
| `getAppointmentReview(id)` | `GET /appointments/{id}/review` | Appointment, patient, schedules, blocks, nearby slot checks. Wider clinic data is returned only to Receptionist/Admin. | Receptionist/Admin, assigned Doctor, owning Patient | 403/404 |
| `approveAppointment(id)` | `POST /appointments/{id}/approve` | Empty JSON. Transaction re-reads Pending Approval/accepted reschedule, checks patient+doctor schedules and blocks, then schedules and creates audit+notifications. | Receptionist only | 403/404/409 conflict or invalid state |
| `proposeAppointmentTime(id,date,time)` | `POST /appointments/{id}/propose-time` | `{date,time}`. Proposal does not confirm or replace an existing booking; affected user must accept, then Receptionist approves. | Receptionist only | 403/409/422 |
| `acceptProposedAppointmentTime(id)` | `POST /appointments/{id}/accept-proposed-time` | Empty JSON; proposal remains awaiting Receptionist final scheduling | Appointment's Patient or Doctor | 403/409 |
| `rejectAppointment(id,reason)` | `POST /appointments/{id}/reject` | `{reason}` | Receptionist only | 403/409/422 |
| `requestAppointmentReschedule(id,input)` | `POST /appointments/{id}/reschedule-request` | `{date,time,reason}` → `Reschedule Requested`; an existing confirmed slot remains intact | Assigned Patient or Doctor | 403/409/422 |
| `requestAppointmentCancellation(id,reason)` | `POST /appointments/{id}/cancellation-request` | `{reason}`; request is not silently treated as cancellation | Assigned Patient or Doctor | 403/409/422 |
| `cancelAppointment(id,reason)` | `POST /appointments/{id}/cancel` | `{reason}`; cancellation + audit + notifications are atomic | Receptionist only | 403/409/422 |
| `transitionAppointment(id,status)` | `PATCH /appointments/{id}/status` | `{status}`; only allowed role/state transitions are accepted | Receptionist / assigned Doctor (state-dependent) | 403/409/422 |
| `api.list('consultations')`, `create`, `update` | `GET/POST/PUT /consultations[/{id}]` | Phase 1 `Consultation` fields; patient/provider are server-bound to assigned appointment/Doctor | Doctor writes own; Doctor/Patient/Admin read permitted records; Receptionist denied | 403/404/409/422 |
| `api.list('prescriptions')`, `create`, `update` | `GET/POST/PUT /prescriptions[/{id}]` | Phase 1 prescription/item shape | Doctor creates/updates own; Pharmacist processes; Patient reads own; Admin reads | 403/404/409/422 |
| `dispensePrescription(id)` | `POST /prescriptions/{id}/dispense` | Empty JSON; all line quantities verified and deducted with status+audit in one transaction | Pharmacist only | 403/404/409 insufficient stock or state |
| `api.list('labOrders')`, `update` | `GET/PUT /labOrders[/{id}]` | Phase 1 statuses `Ordered → Collected → Processing → Completed → Reviewed`; result required at completion | Laboratory Technician updates; Doctor sees relevant; Patient sees Reviewed; Receptionist denied | 403/404/409/422 |
| `api.list('patients')`, create/update | `GET/POST/PUT /patients[/{id}]` | Patient fields from Phase 1; MRN/registration assigned by server | Admin/Receptionist manage; clinical roles get required patients only; Patient gets own | 403/404/409/422 |
| Patient profile records | `GET /medical-records/{patientId}` | Aggregated patient, consultations, prescriptions, lab results permitted to caller | Patient own; assigned Doctor; Admin; relevant lab/pharmacy workflow roles | 403/404 |
| Medical record timeline | `GET /medical-records` | `{patients,rows}` matching the Phase 1 timeline row shape | Role-scoped; Receptionist denied clinical content | 403 |
| `adjustMedicineStock(id,change,note)` | `POST /medicines/{id}/stock-adjustments` | `{change,note}` → updated medicine; audit included | Pharmacist/Admin | 403/404/409 cannot go below zero |
| `dispensePrescription` | `POST /prescriptions/{id}/dispense` | See dedicated dispensing endpoint | Pharmacist | 409 insufficient stock/state |
| `receiveProcurement(id)` | `POST /procurement/{id}/receive` | Empty JSON; increments all referenced stock, sets Received, audits transactionally | Pharmacist/Admin | 403/404/409 invalid or duplicate receive |
| Procurement status updates through `api.update` | `PUT /procurement/{id}` | Status transitions Draft→Submitted→Approved; item edits only while Draft/Submitted. Receiving uses dedicated endpoint. | Pharmacist/Admin | 403/409/422 |
| Invoice payment via `setInvoicePayment(id,paid)` | `POST /invoices/{id}/payments` | Backend accepts `{amount}` (incremental payment ≤ outstanding). Phase 1's `paid` argument is a desired cumulative paid total, so a future HTTP facade adapter sends `amount = max(0, paid - currentInvoice.paid)`. Status is server-calculated. | Receptionist/Admin; Patient reads own only | 403/404/409 void invoice/422 overpayment |
| Invoice void through Phase 1 `update(...,{status:'Void'})` | `PUT /invoices/{id}` | `{status:'Void'}` is the only client-requested status accepted; server stamps actor/time and audit. `DELETE` also soft-voids. | Receptionist/Admin | 403/404/409 |
| `markNotificationRead(id)` | `PATCH /notifications/{id}/read` | Marks one user's notification read | Recipient only | 403/404 |
| `api.list('notifications')` | `GET /notifications` | Own/role-addressed notifications only | All roles | 401 |
| `api.list('audit')` | `GET /audit` | Audit event list; immutable to clients | Admin only | 403 |
| `api.list('settings')`, create/update | `GET/POST/PUT /settings[/{id}]` | Phase 1 system-setting fields | Admin only | 403 |
| `reports.data(kind,range)` | `GET /reports/{financial\|operational}?from=...&to=...&format=json` | `{kind,from,to,rows}` | Admin (financial+operational), Receptionist (operational) | 403/422 |
| `reports.file(kind,'pdf'\|'xlsx',range)` | `GET /reports/{kind}?from=...&to=...&format=pdf\|xlsx` | Downloadable PDF or XLSX from the same report rows | Same report role matrix | 403/422 |
| Print-compatible report | `GET /reports/{kind}?format=print` | HTML report with print invocation | Same report role matrix | 403/422 |
| CSV report (additional) | `GET /reports/{kind}?format=csv` | CSV download | Same report role matrix | 403/422 |
| `reset()` | Not exposed in Phase 2 | Phase 1 reset clears browser-only synthetic data and signs out. The backend intentionally has no authenticated reset endpoint that could erase persistent server data. | — | — |

## Resource role matrix

| Resource | Admin | Receptionist | Doctor | Pharmacist | Lab Technician | Patient |
|---|---|---|---|---|---|---|
| Patients | Manage | Manage | Appointed patients | Prescription-related | Lab-related | Self only |
| Appointments | Read | Review/manage | Assigned | — | — | Own |
| Availability | Manage all | Manage all | Own Doctor block | — | — | Own Patient block |
| Consultations | Read | — | Assigned appointments | — | — | Own |
| Prescriptions | Read | — | Create/edit own | Process/dispense | — | Own |
| Lab orders/results | Read | — | Relevant patient read | — | Update workflow | Reviewed results only |
| Medicines/suppliers/procurement | Manage | — | — | Manage | — | — |
| Invoices | Manage | Manage | — | — | — | Own read-only |
| Users | Manage | Read staff directory | — | — | — | — |
| Audit/settings | Manage/read | — | — | — | — | — |
| Notifications | Own/role | Own/role | Own/role | Own/role | Own/role | Own |

There are exactly six roles. There is no Finance role. The existing frontend's colors, routes, fields, and workflows have not been changed. The `GET /appointments` list returns in-scope records; the browser's existing filters/sorting continue to operate on those results. For transport pagination use `page`/`pageSize` and response `meta`.
