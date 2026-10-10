import "dotenv/config";
import express, { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { db, transaction } from "../db/database.js";
import { resetAndSeed } from "../db/seed.js";
import {
  formatINRPaise,
  paiseToRupees,
  rupeesToPaise,
} from "../domain/money.js";
import { records as store } from "../repositories/recordRepository.js";
import { createWorkflowServices } from "../services/workflows.js";
import {
  ApiError,
  fail,
  ok,
  requireAuth,
  requireIdentity,
  requireRole,
  issueToken,
  jwtSecret,
  roles,
  type Identity,
} from "../http.js";
import type { Role } from "../domain/types.js";

const collections = [
  "patients",
  "appointments",
  "availabilityBlocks",
  "consultations",
  "prescriptions",
  "labOrders",
  "medicines",
  "suppliers",
  "procurement",
  "invoices",
  "users",
  "audit",
  "notifications",
  "settings",
] as const;
type Collection = (typeof collections)[number];
const prefixes: Record<Collection, string> = {
  patients: "pat",
  appointments: "apt",
  availabilityBlocks: "avb",
  consultations: "con",
  prescriptions: "rx",
  labOrders: "lab",
  medicines: "med",
  suppliers: "sup",
  procurement: "po",
  invoices: "inv",
  users: "usr",
  audit: "aud",
  notifications: "ntf",
  settings: "set",
};
const appointmentStatuses = [
  "Pending Approval",
  "Approved",
  "Scheduled",
  "Checked In",
  "In Consultation",
  "Completed",
  "Cancelled",
  "Rejected",
  "No Show",
  "Reschedule Requested",
];
const activeSlotStatuses = new Set([
  "Approved",
  "Scheduled",
  "Checked In",
  "In Consultation",
  "Reschedule Requested",
]);
const closedStatuses = new Set([
  "Completed",
  "Cancelled",
  "Rejected",
  "No Show",
]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown) => {
  if (typeof v !== "string" || !datePattern.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const isoDateSchema = z
  .string()
  .regex(datePattern)
  .refine(isoDate, "Invalid calendar date");
const timeSchema = z.string().regex(timePattern);
const text = (value: any) => (typeof value === "string" ? value.trim() : "");
const newId = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;
const timestamp = () => new Date().toISOString();
const atLocal = () => {
  const { date, time } = clinicNow();
  return `${date} ${time}`;
};
const getBody = (req: Request) =>
  req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
const allowed = (role: Role, set: Role[]) => set.includes(role);

function audit(
  actor: Identity | null,
  action: string,
  area: string,
  recordId: string,
  details: string,
  meta?: unknown,
) {
  store.put("audit", {
    id: newId("aud"),
    at: atLocal(),
    actor: actor?.name ?? "Careflow System",
    role: actor?.role ?? "System",
    action,
    area,
    recordId,
    details,
    actorUserId: actor?.userId ?? null,
    ...(meta ? { metadata: meta } : {}),
  });
}
function notify(
  recipientId: string | undefined,
  role: Role | "All staff",
  title: string,
  message: string,
  href: string,
  patientId?: string,
) {
  store.put("notifications", {
    id: newId("ntf"),
    role,
    ...(recipientId ? { recipientId } : {}),
    ...(patientId ? { patientId } : {}),
    title,
    message,
    at: atLocal(),
    href,
    read: false,
  });
}
function notifyReceptionists(title: string, message: string) {
  const recipients = store
    .list("users")
    .filter((u: any) => u.role === "Receptionist" && u.status === "Active");
  recipients.forEach((u: any) =>
    notify(u.id, "Receptionist", title, message, "/appointments"),
  );
}
function notifyAppointmentParties(
  appointment: any,
  title: string,
  message: string,
) {
  const patientUser = store
    .list("users")
    .find(
      (u: any) => u.role === "Patient" && u.patientId === appointment.patientId,
    );
  if (patientUser)
    notify(
      patientUser.id,
      "Patient",
      title,
      message,
      "/appointments",
      appointment.patientId,
    );
  if (appointment.doctorId)
    notify(
      appointment.doctorId,
      "Doctor",
      title,
      message,
      "/appointments",
      appointment.patientId,
    );
}
function requireRecord(collection: string, id: string): any {
  const record = store.get(collection, id);
  if (!record)
    throw new ApiError(404, "NOT_FOUND", `${collection} record was not found.`);
  return record;
}
function scopedPatientIds(identity: Identity): Set<string> {
  if (identity.role === "Patient")
    return new Set(identity.patientId ? [identity.patientId] : []);
  if (identity.role === "Doctor")
    return new Set(
      store
        .list("appointments")
        .filter((a: any) => a.doctorId === identity.userId)
        .map((a: any) => a.patientId),
    );
  if (identity.role === "Laboratory Technician")
    return new Set(
      store
        .list("labOrders")
        .filter(
          (a: any) =>
            (!a.assignedToUserId && !a.assignedTo) ||
            a.assignedToUserId === identity.userId,
        )
        .map((a: any) => a.patientId),
    );
  if (identity.role === "Pharmacist")
    return new Set(store.list("prescriptions").map((a: any) => a.patientId));
  return new Set();
}
function canReadRecord(
  collection: Collection,
  record: any,
  identity: Identity,
): boolean {
  const role = identity.role;
  switch (collection) {
    case "patients":
      return (
        ["Clinic Administrator", "Receptionist"].includes(role) ||
        scopedPatientIds(identity).has(record.id)
      );
    case "appointments":
      return (
        ["Clinic Administrator", "Receptionist"].includes(role) ||
        (role === "Doctor" && record.doctorId === identity.userId) ||
        (role === "Patient" && record.patientId === identity.patientId)
      );
    case "availabilityBlocks":
      return (
        ["Clinic Administrator", "Receptionist"].includes(role) ||
        (record.targetType === "Doctor" &&
          role === "Doctor" &&
          record.targetId === identity.userId) ||
        (record.targetType === "Patient" &&
          role === "Patient" &&
          record.targetId === identity.patientId)
      );
    case "consultations":
      return (
        role === "Clinic Administrator" ||
        (role === "Doctor" &&
          record.doctorId === identity.userId &&
          store
            .list("appointments")
            .some(
              (a: any) =>
                a.id === record.appointmentId && a.doctorId === identity.userId,
            )) ||
        (role === "Patient" && record.patientId === identity.patientId)
      );
    case "prescriptions":
      return (
        role === "Clinic Administrator" ||
        role === "Pharmacist" ||
        (role === "Doctor" && record.doctorId === identity.userId) ||
        (role === "Patient" && record.patientId === identity.patientId)
      );
    case "labOrders":
      return (
        role === "Clinic Administrator" ||
        (role === "Laboratory Technician" &&
          ((!record.assignedToUserId && !record.assignedTo) ||
            record.assignedToUserId === identity.userId)) ||
        (role === "Doctor" &&
          scopedPatientIds(identity).has(record.patientId)) ||
        (role === "Patient" &&
          record.patientId === identity.patientId &&
          record.status === "Reviewed")
      );
 case "medicines":
  return ["Clinic Administrator", "Pharmacist", "Doctor"].includes(role);
case "suppliers":
case "procurement":
  return ["Clinic Administrator", "Pharmacist"].includes(role);
case "invoices":
  return (
    ["Clinic Administrator", "Receptionist"].includes(role) ||
    (role === "Patient" && record.patientId === identity.patientId)
  );
    case "users":
      return (
        role === "Clinic Administrator" ||
        (role === "Receptionist" && record.role === "Doctor") ||
        (role === "Doctor" &&
          (record.id === identity.userId ||
            (record.role === "Doctor" && record.status === "Active"))) ||
        (role === "Patient" &&
          record.role === "Doctor" &&
          record.status === "Active")
      );
    case "audit":
      return role === "Clinic Administrator";
    case "notifications":
      return isNotificationVisible(record, identity);
    case "settings":
      return role === "Clinic Administrator";
    default:
      return false;
  }
}
function isNotificationVisible(item: any, identity: Identity) {
  if (item.recipientId) return item.recipientId === identity.userId;
  if (identity.role === "Patient")
    return item.role === "Patient" && item.patientId === identity.patientId;
  return item.role === "All staff" || item.role === identity.role;
}
function patientPrescriptionView(prescription: any) {
  return {
    ...prescription,
    items: (prescription.items ?? []).map((line: any) => {
      const medicine = store.get("medicines", line.medicineId);
      return {
        ...line,
        medicineName: medicine?.name ?? "Medicine",
        medicineStrength: medicine?.strength ?? "",
      };
    }),
  };
}
function readableCollection(collection: Collection, identity: Identity): any[] {
  const rows = store
    .list(collection)
    .filter((r: any) => canReadRecord(collection, r, identity));
  if (collection === "prescriptions" && identity.role === "Patient")
    return rows.map(patientPrescriptionView);
  if (
    collection === "patients" &&
    ["Pharmacist", "Laboratory Technician"].includes(identity.role)
  )
    return rows.map((p: any) => ({
      id: p.id,
      mrn: p.mrn,
      name: p.name,
      status: p.status,
    }));
  return rows;
}
function assertCanRead(
  collection: Collection,
  record: any,
  identity: Identity,
) {
  if (!canReadRecord(collection, record, identity))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You are not authorized to access this record.",
    );
}
function validateDateTime(date: unknown, time: unknown) {
  if (
    !isoDate(date) ||
    typeof time !== "string" ||
    !timePattern.test(time) ||
    ![...Array(19)].some((_, i) => {
      const m = 480 + i * 30;
      return (
        time ===
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
      );
    })
  )
    throw new ApiError(
      422,
      "INVALID_APPOINTMENT_SLOT",
      "Choose a valid future clinic date and 30-minute slot between 08:00 and 17:00.",
    );
  const { date: todayKey, time: nowTime } = clinicNow();
  if ((date as string) < todayKey)
    throw new ApiError(
      422,
      "INVALID_APPOINTMENT_SLOT",
      "Appointment date must not be in the past.",
    );
  if ((date as string) === todayKey && minute(time) <= minute(nowTime))
    throw new ApiError(
      422,
      "INVALID_APPOINTMENT_SLOT",
      "Appointment time must be later than the current clinic time.",
    );
}
const minute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.CLINIC_TIME_ZONE ?? "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}
function slotHasElapsed(date: string, time: string, durationMinutes = 0) {
  const now = clinicNow();
  return (
    date < now.date ||
    (date === now.date && minute(time) + durationMinutes <= minute(now.time))
  );
}
function overlaps(a: string, b: string, c: string, d: string) {
  return minute(a) < minute(d) && minute(c) < minute(b);
}
function availability(
  patientId: string,
  doctorId: string,
  date: string,
  time: string,
  excludeId?: string,
) {
  const end = `${String(Math.floor((minute(time) + 30) / 60)).padStart(2, "0")}:${String((minute(time) + 30) % 60).padStart(2, "0")}`;
  const slotDate = (a: any) =>
    a.status === "Reschedule Requested" && a.confirmedDate
      ? a.confirmedDate
      : a.date;
  const slotTime = (a: any) =>
    a.status === "Reschedule Requested" && a.confirmedTime
      ? a.confirmedTime
      : a.time;
  const slots = store
    .list("appointments")
    .filter(
      (a: any) =>
        a.id !== excludeId &&
        slotDate(a) === date &&
        activeSlotStatuses.has(a.status) &&
        (a.status !== "Reschedule Requested" || Boolean(a.confirmedDate)),
    );
  const pa = slots.find(
    (a: any) =>
      a.patientId === patientId &&
      overlaps(
        time,
        end,
        slotTime(a),
        `${String(Math.floor((minute(slotTime(a)) + 30) / 60)).padStart(2, "0")}:${String((minute(slotTime(a)) + 30) % 60).padStart(2, "0")}`,
      ),
  );
  const da = slots.find(
    (a: any) =>
      a.doctorId === doctorId &&
      overlaps(
        time,
        end,
        slotTime(a),
        `${String(Math.floor((minute(slotTime(a)) + 30) / 60)).padStart(2, "0")}:${String((minute(slotTime(a)) + 30) % 60).padStart(2, "0")}`,
      ),
  );
  const blocks = store
    .list("availabilityBlocks")
    .filter((b: any) => b.active && b.date === date);
  const pb = blocks.find(
    (b: any) =>
      b.targetType === "Patient" &&
      b.targetId === patientId &&
      overlaps(time, end, b.startTime, b.endTime),
  );
  const dbb = blocks.find(
    (b: any) =>
      b.targetType === "Doctor" &&
      b.targetId === doctorId &&
      overlaps(time, end, b.startTime, b.endTime),
  );
  const patientName = store.get("patients", patientId)?.name ?? "Patient";
  const doctorName = store.get("users", doctorId)?.name ?? "Doctor";
  const patientConflict = pa
    ? `${patientName} already has an appointment at ${pa.time}.`
    : pb
      ? `${patientName} is unavailable from ${pb.startTime} to ${pb.endTime}.`
      : "";
  const doctorConflict = da
    ? `${doctorName} already has an appointment at ${da.time}.`
    : dbb
      ? `${doctorName} is unavailable from ${dbb.startTime} to ${dbb.endTime}.`
      : "";
  return {
    time,
    canSchedule: !patientConflict && !doctorConflict,
    patientConflict,
    doctorConflict,
    message:
      patientConflict || doctorConflict
        ? `Cannot schedule this appointment. ${[doctorConflict, patientConflict].filter(Boolean).join(" ")}`
        : "Both patient and doctor are available.",
  };
}
function assertAppointmentParty(a: any, identity: Identity) {
  if (identity.role === "Patient" && a.patientId === identity.patientId) return;
  if (identity.role === "Doctor" && a.doctorId === identity.userId) return;
  throw new ApiError(
    403,
    "FORBIDDEN",
    "This appointment is not available to the current user.",
  );
}
function patientUser(patientId: string) {
  return store
    .list("users")
    .find((u: any) => u.role === "Patient" && u.patientId === patientId);
}
function appointmentRequest(body: any, identity: Identity) {
  const patientId =
    identity.role === "Patient" ? identity.patientId : text(body.patientId);
  if (!patientId)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "A patient is required for this request.",
    );
  const patient = requireRecord("patients", patientId);
  if (identity.role === "Doctor" && !scopedPatientIds(identity).has(patientId))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Doctor may request appointments only for patients in their assigned care.",
    );
  if (patient.status !== "Active")
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "The selected patient record is inactive.",
    );
  const doctorId =
    identity.role === "Doctor" ? identity.userId : text(body.doctorId);
  const doctor = requireRecord("users", doctorId);
  if (doctor.role !== "Doctor" || doctor.status !== "Active")
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Choose an active clinic Doctor.",
    );
  const requestedDate = text(body.requestedDate ?? body.date),
    requestedTime = text(body.requestedTime ?? body.time);
  validateDateTime(requestedDate, requestedTime);
  const type = text(body.type),
    reason = text(body.reason);
  if (!type || type.length > 80 || !reason || reason.length > 1000)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Visit type and a reason of at most 1000 characters are required.",
    );
  if (body.department && body.department !== doctor.department)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "The selected department must match the selected Doctor.",
    );
  const id = newId("apt"),
    now = timestamp();
  const appointment = {
    id,
    patientId,
    doctorId,
    provider: doctor.name,
    department: doctor.department,
    date: requestedDate,
    time: requestedTime,
    requestedDate,
    requestedTime,
    type,
    reason,
    requestedById: identity.userId,
    requestedByName: identity.name,
    requestedByRole: identity.role,
    createdAt: now,
    updatedAt: now,
    status: "Pending Approval",
  };
  store.put("appointments", appointment);
  audit(
    identity,
    "Appointment request submitted",
    "Appointments",
    id,
    `${identity.role} requested ${type} for ${patient.name} with ${doctor.name} on ${requestedDate} at ${requestedTime}.`,
  );
  notifyReceptionists(
    identity.role === "Patient"
      ? "Patient appointment request"
      : identity.role === "Doctor"
        ? "Doctor appointment request"
        : "Receptionist appointment request",
    `${patient.name} · ${doctor.name} · ${requestedDate} ${requestedTime}.`,
  );
  notifyAppointmentParties(
    appointment,
    "Appointment request submitted",
    `${patient.name} · ${doctor.name} · ${requestedDate} ${requestedTime} · ${type}.`,
  );
  return appointment;
}
function assertAlternative(
  date: string,
  time: string,
  patientId: string,
  doctorId: string,
  id: string,
) {
  validateDateTime(date, time);
  const result = availability(patientId, doctorId, date, time, id);
  if (!result.canSchedule)
    throw new ApiError(409, "APPOINTMENT_CONFLICT", result.message);
  return result;
}
function doAppointmentAction(fn: () => any) {
  return transaction(fn);
}
function recordOfUser(user: any) {
  const { passwordHash, ...safe } = user;
  return safe;
}
const workflows = createWorkflowServices({
  records: store,
  transaction,
  requireRecord,
  availability,
  audit,
  notifyAppointmentParties,
  timestamp,
  ApiError,
});

const api = express.Router();
function sumLineItemsPaise(items: any[], priceKey = "unitPrice"): number {
  let total = 0n;
  for (const item of items) {
    const unit = BigInt(rupeesToPaise(item[priceKey]));
    const quantity = BigInt(item.quantity);
    total += unit * quantity;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Invoice or order total exceeds the supported limit.",
    );
  return Number(total);
}
function validRupee(value: unknown): boolean {
  try {
    rupeesToPaise(value);
    return true;
  } catch {
    return false;
  }
}

// Authentication: client-supplied role or patient IDs are never used as identity claims.
api.post("/auth/login", (req, res) => {
  const parsed = z
    .object({
      username: z.string().min(1).max(120),
      password: z.string().min(1).max(256),
    })
    .safeParse(getBody(req));
  if (!parsed.success)
    return fail(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Username or password is incorrect.",
    );
  const username = parsed.data.username.trim();
  const cred = db
    .prepare(
      "SELECT user_id, username, password_hash, failed_attempts, locked_until, token_version FROM credentials WHERE username = ? COLLATE NOCASE",
    )
    .get(username) as any;
  const dummy = "$2a$10$C6UzMDM.H6dfI/f/IKcEe.1J1.YE3wTA4qhqI4Q2DTrSQBqpA.3qe";
  const locked =
    cred?.locked_until && new Date(cred.locked_until).getTime() > Date.now();
  const passOk = bcrypt.compareSync(
    parsed.data.password,
    cred?.password_hash ?? dummy,
  );
  if (!cred || !passOk || locked) {
    if (cred && !locked) {
      const tries = cred.failed_attempts + 1;
      const limit = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
      const lockUntil =
        tries >= limit
          ? new Date(
              Date.now() + Number(process.env.LOGIN_LOCK_MINUTES ?? 15) * 60000,
            ).toISOString()
          : null;
      db.prepare(
        "UPDATE credentials SET failed_attempts=?, locked_until=? WHERE user_id=?",
      ).run(tries, lockUntil, cred.user_id);
    }
    audit(
      null,
      "Login failed",
      "Authentication",
      cred?.user_id ?? "unknown",
      "Invalid credentials or locked account.",
    );
    return fail(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Username or password is incorrect.",
    );
  }
  const user = store.get("users", cred.user_id);
  if (!user || user.status !== "Active")
    return fail(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Username or password is incorrect.",
    );
  db.prepare(
    "UPDATE credentials SET failed_attempts=0, locked_until=NULL WHERE user_id=?",
  ).run(user.id);
  const identity: Identity = {
    userId: user.id,
    name: user.name,
    role: user.role,
    patientId: user.patientId,
    department: user.department,
  };
  audit(
    identity,
    "Login succeeded",
    "Authentication",
    user.id,
    "Successful authenticated login.",
  );
  return ok(res, {
    token: issueToken(identity, cred.token_version),
    tokenType: "Bearer",
    expiresIn: 28800,
    user: identity,
  });
});
api.use(requireAuth);
api.post("/auth/logout", (req, res) => {
  const me = requireIdentity(req);
  transaction(() => {
    db.prepare(
      "UPDATE credentials SET token_version=token_version+1 WHERE user_id=?",
    ).run(me.userId);
    audit(
      me,
      "Logout",
      "Authentication",
      me.userId,
      "User logged out; active bearer tokens invalidated.",
    );
  });
  return ok(res, { loggedOut: true });
});
api.get("/auth/me", (req, res) => ok(res, requireIdentity(req)));
api.post("/dev/reset", requireRole("Clinic Administrator"), (req, res) => {
  if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  resetAndSeed();
  return ok(res, {
    reset: true,
    message: "Development database restored to the synthetic relational seed.",
  });
});

// Profile and per-user presentation preferences (not authentication credentials).
api.get("/profile", (req, res) => ok(res, requireIdentity(req)));
api.put("/profile/password", (req, res) => {
  const me = requireIdentity(req);
  const b = getBody(req);
  const parsed = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(10).max(128),
    })
    .safeParse(b);
  if (!parsed.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Current password and a new password of at least 10 characters are required.",
    );
  const c = db
    .prepare("SELECT password_hash FROM credentials WHERE user_id=?")
    .get(me.userId) as any;
  if (!c || !bcrypt.compareSync(parsed.data.currentPassword, c.password_hash))
    throw new ApiError(
      401,
      "CURRENT_PASSWORD_INVALID",
      "Current password is incorrect.",
    );
  transaction(() => {
    db.prepare(
      "UPDATE credentials SET password_hash=?,failed_attempts=0,locked_until=NULL,token_version=token_version+1 WHERE user_id=?",
    ).run(bcrypt.hashSync(parsed.data.newPassword, 10), me.userId);
    audit(
      me,
      "Password changed",
      "Authentication",
      me.userId,
      "Password changed; previous access tokens invalidated.",
    );
  });
  return ok(res, { changed: true, reauthenticationRequired: true });
});
api.get("/profile/preferences", (req, res) => {
  const me = requireIdentity(req);
  const row = db
    .prepare(
      "SELECT date_format,compact_tables FROM preferences WHERE user_id=?",
    )
    .get(me.userId) as any;
  return ok(
    res,
    row
      ? {
          dateFormat: row.date_format,
          compactTables: Boolean(row.compact_tables),
        }
      : { dateFormat: "MMM D, YYYY", compactTables: false },
  );
});
api.patch("/profile/preferences", (req, res) => {
  const me = requireIdentity(req);
  const schema = z
    .object({
      dateFormat: z
        .enum(["MMM D, YYYY", "DD/MM/YYYY", "YYYY-MM-DD"])
        .optional(),
      compactTables: z.boolean().optional(),
    })
    .strict();
  const patch = schema.parse(getBody(req));
  const row = db
    .prepare(
      "SELECT date_format,compact_tables FROM preferences WHERE user_id=?",
    )
    .get(me.userId) as any;
  const next = {
    dateFormat: "MMM D, YYYY",
    compactTables: false,
    ...(row
      ? {
          dateFormat: row.date_format,
          compactTables: Boolean(row.compact_tables),
        }
      : {}),
    ...patch,
  };
  db.prepare(
    "INSERT INTO preferences(user_id,date_format,compact_tables,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET date_format=excluded.date_format,compact_tables=excluded.compact_tables,updated_at=excluded.updated_at",
  ).run(
    me.userId,
    next.dateFormat,
    next.compactTables ? 1 : 0,
    new Date().toISOString(),
  );
  return ok(res, next);
});

// Role-safe lookups and dashboard/report adapters used by the existing Phase 1 facade.
api.get("/users/doctors", (req, res) =>
  ok(
    res,
    store
      .list("users")
      .filter((u: any) => u.role === "Doctor" && u.status === "Active")
      .map((u: any) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        department: u.department,
        status: u.status,
      })),
  ),
);
api.get("/dashboard/snapshot", (req, res) => {
  const me = requireIdentity(req);
  const data: any = {};
  for (const c of collections) data[c] = readableCollection(c, me);
  // A pharmacist/lab role sees only workflow-relevant patient rows and no broad patient directory.
  return ok(res, data);
});
api.get("/appointments/dashboard-summary", (req, res) => {
  const me = requireIdentity(req);
  const date = text(req.query.today) || clinicNow().date;
  if (!isoDate(date))
    throw new ApiError(422, "VALIDATION_ERROR", "today must be YYYY-MM-DD.");
  const appts = readableCollection("appointments", me);
  const pending = appts.filter(
    (a: any) =>
      ["Pending Approval", "Reschedule Requested"].includes(a.status) &&
      !a.proposalById &&
      !a.cancellationRequestedAt,
  );
  const pendingRequests = appts.filter(
    (a: any) =>
      (["Pending Approval", "Reschedule Requested"].includes(a.status) &&
        !a.proposalById) ||
      (a.cancellationRequestedAt && !closedStatuses.has(a.status)),
  );
  const todayAppointments = appts
    .filter(
      (a: any) =>
        (activeSlotStatuses.has(a.status) ||
          (a.status === "Reschedule Requested" && a.confirmedDate)) &&
        (a.confirmedDate ?? a.date) === date,
    )
    .sort((a: any, b: any) =>
      (a.confirmedTime ?? a.time).localeCompare(b.confirmedTime ?? b.time),
    );
  const blockCount = readableCollection("availabilityBlocks", me).filter(
    (b: any) => b.active && b.date === date,
  ).length;
  const conflicts = pending.filter(
    (a: any) =>
      !availability(
        a.patientId,
        a.doctorId,
        a.requestedDate,
        a.requestedTime,
        a.id,
      ).canSchedule,
  ).length;
  return ok(res, {
    pendingCount: pending.length,
    todayConfirmedCount: todayAppointments.length,
    todayBlocksCount: blockCount,
    conflictingRequestsCount: conflicts,
    todayAppointments,
    pendingRequests,
  });
});

// Appointment operations: request remains Pending Approval until Receptionist approval.
api.post("/appointments", (req, res) => {
  const me = requireIdentity(req);
  if (!["Patient", "Doctor", "Receptionist"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Patient, Doctor, or Receptionist may submit an appointment request.",
    );
  const appointment = doAppointmentAction(() =>
    appointmentRequest(getBody(req), me),
  );
  return ok(res, appointment, 201);
});
api.get("/appointments/availability/check", (req, res) => {
  const me = requireIdentity(req);
  if (!["Receptionist", "Clinic Administrator"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only Receptionist or Administrator may review clinic-wide availability.",
    );
  const p = idSchema.parse(req.query.patientId),
    d = idSchema.parse(req.query.doctorId),
    date = isoDateSchema.parse(req.query.date),
    time = timeSchema.parse(req.query.time),
    exclude = req.query.excludeAppointmentId
      ? String(req.query.excludeAppointmentId)
      : undefined;
  validateDateTime(date, time);
  return ok(res, availability(p, d, date, time, exclude));
});
api.get("/appointments/availability/slots", (req, res) => {
  const me = requireIdentity(req);
  if (!["Receptionist", "Clinic Administrator"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only Receptionist or Administrator may review clinic-wide availability.",
    );
  const patientId = idSchema.parse(req.query.patientId),
    doctorId = idSchema.parse(req.query.doctorId),
    date = isoDateSchema.parse(req.query.date),
    exclude = req.query.excludeAppointmentId
      ? String(req.query.excludeAppointmentId)
      : undefined;
  const times = Array.from({ length: 19 }, (_, i) => {
    const m = 480 + i * 30;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
  return ok(
    res,
    times
      .map((t) => availability(patientId, doctorId, date, t, exclude))
      .filter((x) => x.canSchedule),
  );
});
api.get("/appointments/:id/review", (req, res) => {
  const me = requireIdentity(req),
    a = requireRecord("appointments", idSchema.parse(req.params.id));
  if (!["Receptionist", "Clinic Administrator"].includes(me.role))
    assertAppointmentParty(a, me);
  const date = a.proposedDate ?? a.requestedDate,
    time = a.proposedTime ?? a.requestedTime;
  const clinicWide = ["Receptionist", "Clinic Administrator"].includes(me.role);
  const patientSchedule = store
    .list("appointments")
    .filter(
      (x: any) =>
        x.id !== a.id &&
        x.patientId === a.patientId &&
        x.date === date &&
        activeSlotStatuses.has(x.status),
    );
  const doctorSchedule =
    clinicWide || me.role === "Doctor"
      ? store
          .list("appointments")
          .filter(
            (x: any) =>
              x.id !== a.id &&
              x.doctorId === a.doctorId &&
              x.date === date &&
              activeSlotStatuses.has(x.status),
          )
      : [];
  const blocks = store
    .list("availabilityBlocks")
    .filter(
      (x: any) =>
        x.active &&
        x.date === date &&
        ((x.targetType === "Patient" && x.targetId === a.patientId) ||
          (x.targetType === "Doctor" && x.targetId === a.doctorId)),
    );
  const nearby = [-30, 0, 30, 60]
    .map((o) => minute(time) + o)
    .filter((m) => m >= 480 && m <= 1020)
    .map((m) =>
      availability(
        a.patientId,
        a.doctorId,
        date,
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
        a.id,
      ),
    );
  return ok(res, {
    appointment: a,
    patient: store.get("patients", a.patientId),
    patients: clinicWide
      ? store.list("patients")
      : [store.get("patients", a.patientId)].filter(Boolean),
    patientSchedule,
    doctorSchedule: clinicWide ? doctorSchedule : [],
    patientBlocks: blocks.filter((x) => x.targetType === "Patient"),
    doctorBlocks: clinicWide
      ? blocks.filter((x) => x.targetType === "Doctor")
      : [],
    nearbySlots: clinicWide ? nearby : [],
  });
});
api.post("/appointments/:id/approve", (req, res) => {
  const me = requireIdentity(req);
  if (me.role !== "Receptionist")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Receptionist may approve or schedule appointment requests.",
    );
  const result = workflows.approveAppointment(
    idSchema.parse(req.params.id),
    me,
  );
  return ok(res, result);
});
api.post("/appointments/:id/propose-time", (req, res) => {
  const me = requireIdentity(req);
  if (me.role !== "Receptionist")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Receptionist may propose an alternative time.",
    );
  const id = idSchema.parse(req.params.id),
    b = z.object({ date: isoDateSchema, time: timeSchema }).parse(getBody(req));
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    if (
      !["Pending Approval", "Reschedule Requested", "Scheduled"].includes(
        row.status,
      )
    )
      throw new ApiError(
        409,
        "INVALID_STATE",
        "This appointment cannot be rescheduled in its current state.",
      );
    assertAlternative(b.date, b.time, row.patientId, row.doctorId, id);
    row.proposedDate = b.date;
    row.proposedTime = b.time;
    row.proposalById = me.userId;
    row.proposalByName = me.name;
    delete row.proposalAcceptedById;
    delete row.proposalAcceptedAt;
    row.rescheduleRequestedAt = timestamp();
    row.status = "Reschedule Requested";
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Alternative appointment time proposed",
      "Appointments",
      id,
      `${me.name} proposed ${b.date} ${b.time} after two-sided availability check.`,
    );
    notifyAppointmentParties(
      row,
      "Alternative appointment time proposed",
      `${row.provider} proposed ${b.date} ${b.time}. Review and accept in Appointments.`,
    );
    return row;
  });
  return ok(res, a);
});
api.post("/appointments/:id/accept-proposed-time", (req, res) => {
  const me = requireIdentity(req),
    id = idSchema.parse(req.params.id);
  if (!["Patient", "Doctor"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the affected Patient or Doctor may accept a proposed time.",
    );
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    assertAppointmentParty(row, me);
    if (
      row.status !== "Reschedule Requested" ||
      !row.proposalById ||
      !row.proposedDate ||
      !row.proposedTime
    )
      throw new ApiError(
        409,
        "INVALID_STATE",
        "No proposed appointment time is awaiting acceptance.",
      );
    assertAlternative(
      row.proposedDate,
      row.proposedTime,
      row.patientId,
      row.doctorId,
      id,
    );
    row.requestedDate = row.proposedDate;
    row.requestedTime = row.proposedTime;
    if (!row.confirmedDate) {
      row.date = row.proposedDate;
      row.time = row.proposedTime;
    }
    row.proposalAcceptedById = me.userId;
    row.proposalAcceptedAt = timestamp();
    delete row.proposedDate;
    delete row.proposedTime;
    delete row.proposalById;
    delete row.proposalByName;
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Proposed appointment time accepted",
      "Appointments",
      id,
      `${me.name} accepted the alternative time; final scheduling remains with Receptionist.`,
    );
    notifyReceptionists(
      "Accepted time ready to schedule",
      `${me.name} accepted ${id}; final scheduling is required.`,
    );
    notifyAppointmentParties(
      row,
      "Proposed time accepted",
      `${me.name} accepted the proposed time; Receptionist will confirm scheduling.`,
    );
    return row;
  });
  return ok(res, a);
});
api.post("/appointments/:id/reject", (req, res) => {
  const me = requireIdentity(req);
  if (me.role !== "Receptionist")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Receptionist may reject appointment requests.",
    );
  const id = idSchema.parse(req.params.id),
    reason = text(getBody(req).reason);
  if (!reason)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "A rejection reason is required.",
    );
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    if (
      !["Pending Approval", "Reschedule Requested"].includes(row.status) ||
      row.proposalById
    )
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Appointment is not awaiting a rejection decision.",
      );
    row.status = "Rejected";
    row.rejectionReason = reason;
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Appointment request rejected",
      "Appointments",
      id,
      `${me.name} rejected the request. Reason: ${reason}`,
    );
    notifyAppointmentParties(
      row,
      "Appointment request rejected",
      `${id} was not approved. Reason: ${reason}`,
    );
    return row;
  });
  return ok(res, a);
});
api.post("/appointments/:id/reschedule-request", (req, res) => {
  const me = requireIdentity(req);
  if (!["Patient", "Doctor"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the assigned Patient or Doctor may request rescheduling.",
    );
  const id = idSchema.parse(req.params.id),
    b = z
      .object({
        date: isoDateSchema,
        time: timeSchema,
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(getBody(req));
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    assertAppointmentParty(row, me);
    if (
      ![
        "Pending Approval",
        "Scheduled",
        "Checked In",
        "Reschedule Requested",
      ].includes(row.status)
    )
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Appointment cannot be rescheduled in its current state.",
      );
    validateDateTime(b.date, b.time);
    row.requestedDate = b.date;
    row.requestedTime = b.time;
    if (!row.confirmedDate) {
      row.date = b.date;
      row.time = b.time;
    }
    row.reason = b.reason;
    row.rescheduleRequestedAt = timestamp();
    row.rescheduleRequestedById = me.userId;
    row.rescheduleRequestedByName = me.name;
    row.rescheduleRequestedByRole = me.role;
    for (const key of [
      "proposedDate",
      "proposedTime",
      "proposalById",
      "proposalByName",
      "proposalAcceptedById",
      "proposalAcceptedAt",
    ])
      delete row[key];
    row.status = "Reschedule Requested";
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Appointment reschedule requested",
      "Appointments",
      id,
      `${me.name} requested ${b.date} ${b.time}. ${b.reason}`,
    );
    notifyReceptionists(
      "Appointment reschedule request",
      `${me.name} requested a new time for ${id}.`,
    );
    notifyAppointmentParties(
      row,
      "Appointment time change requested",
      `${me.name} requested ${b.date} ${b.time}; Receptionist will review.`,
    );
    return row;
  });
  return ok(res, a);
});
api.post("/appointments/:id/cancellation-request", (req, res) => {
  const me = requireIdentity(req);
  if (!["Patient", "Doctor"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the assigned Patient or Doctor may request cancellation.",
    );
  const id = idSchema.parse(req.params.id),
    reason = text(getBody(req).reason);
  if (!reason)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "A cancellation reason is required.",
    );
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    assertAppointmentParty(row, me);
    if (
      ![
        "Pending Approval",
        "Scheduled",
        "Checked In",
        "Reschedule Requested",
      ].includes(row.status)
    )
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Appointment cannot be cancelled in its current state.",
      );
    row.cancellationRequestedAt = timestamp();
    row.cancellationRequestedById = me.userId;
    row.cancellationRequestedByName = me.name;
    row.cancellationRequestedByRole = me.role;
    row.cancellationReason = reason;
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Appointment cancellation requested",
      "Appointments",
      id,
      `${me.name} requested cancellation. Reason: ${reason}`,
    );
    notifyReceptionists(
      "Appointment cancellation request",
      `${me.name} requested cancellation of ${id}.`,
    );
    notifyAppointmentParties(
      row,
      "Appointment cancellation requested",
      `${me.name} requested cancellation; Receptionist will review.`,
    );
    return row;
  });
  return ok(res, a);
});
api.post("/appointments/:id/cancel", (req, res) => {
  const me = requireIdentity(req);
  if (!["Receptionist", "Clinic Administrator"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Receptionist or Clinic Administrator may finalize appointment cancellation.",
    );
  const id = idSchema.parse(req.params.id),
    reason = text(getBody(req).reason);
  if (!reason)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "A cancellation reason is required.",
    );
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    if (closedStatuses.has(row.status))
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Appointment is already closed.",
      );
    row.status = "Cancelled";
    row.cancellationReason = reason;
    row.updatedAt = timestamp();
    store.put("appointments", row);
    audit(
      me,
      "Appointment cancelled",
      "Appointments",
      id,
      `${me.name} cancelled appointment. Reason: ${reason}`,
    );
    notifyAppointmentParties(
      row,
      "Appointment cancelled",
      `${id} was cancelled. Reason: ${reason}`,
    );
    return row;
  });
  return ok(res, a);
});
api.patch("/appointments/:id/status", (req, res) => {
  const me = requireIdentity(req),
    id = idSchema.parse(req.params.id),
    status = z
      .enum(["Checked In", "In Consultation", "Completed", "No Show"])
      .parse(getBody(req).status);
  const a = doAppointmentAction(() => {
    const row = requireRecord("appointments", id);
    const transitions: any = {
      "Receptionist:Scheduled": ["Checked In", "No Show"],
      "Receptionist:Checked In": ["In Consultation"],
      "Receptionist:In Consultation": ["Completed", "No Show"],
      "Clinic Administrator:Scheduled": ["Checked In", "No Show"],
      "Clinic Administrator:Checked In": ["In Consultation"],
      "Clinic Administrator:In Consultation": ["Completed", "No Show"],
      "Doctor:Scheduled": ["In Consultation"],
      "Doctor:Checked In": ["In Consultation"],
      "Doctor:In Consultation": ["Completed"],
    };
    if (!transitions[`${me.role}:${row.status}`]?.includes(status))
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        `Cannot transition appointment from ${row.status} to ${status}.`,
      );
    if (status === "No Show") {
      const scheduledDate = row.confirmedDate ?? row.date;
      const scheduledTime = row.confirmedTime ?? row.time;
      if (!slotHasElapsed(scheduledDate, scheduledTime, 30))
        throw new ApiError(
          409,
          "INVALID_STATE",
          "An appointment can be marked No Show only after its scheduled slot has elapsed.",
        );
    }
    if (me.role === "Doctor" && row.doctorId !== me.userId)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Doctors may update only their own appointments.",
      );
    row.status = status;
    row.updatedAt = timestamp();
    store.put("appointments", row);
    if (status === "Completed") {
      const setting = store.get("settings", "consultation-fee");
      const feePaise = Number(setting?.value ?? "50000");
      if (!Number.isSafeInteger(feePaise) || feePaise < 0)
        throw new ApiError(
          500,
          "BILLING_CONFIGURATION_INVALID",
          "The consultation fee setting is invalid; appointment completion was not saved.",
        );
      const issuedAt = clinicNow().date;
      const dueDate = new Date(`${issuedAt}T00:00:00.000Z`);
      dueDate.setUTCDate(dueDate.getUTCDate() + 14);
      store.addConsultationCharge({
        appointmentId: row.id,
        patientId: row.patientId,
        feePaise,
        issuedAt,
        dueAt: dueDate.toISOString().slice(0, 10),
        createdAt: timestamp(),
      });
    }
    audit(
      me,
      `Appointment ${status.toLowerCase()}`,
      "Appointments",
      id,
      `${me.name} changed status to ${status}.`,
    );
    return row;
  });
  return ok(res, a);
});

// Medical records: clinical timeline aggregates only accessible records; patient lab results are released at Reviewed.
api.get("/medical-records", (req, res) => {
  const me = requireIdentity(req);
  if (!["Clinic Administrator", "Doctor", "Patient"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "The medical-record timeline is not available to this role.",
    );
  const p = readableCollection("patients", me),
    ids = new Set(p.map((x: any) => x.id));
  const rows: any[] = [
    ...readableCollection("consultations", me).map((x: any) => ({
      id: x.id,
      patientId: x.patientId,
      date: x.date,
      category: "Consultation",
      description: x.reason,
      status: x.status,
    })),
    ...readableCollection("prescriptions", me).map((x: any) => ({
      id: x.id,
      patientId: x.patientId,
      date: x.date,
      category: "Prescription",
      description: (x.items ?? []).map((i: any) => i.dose).join("; "),
      status: x.status,
    })),
    ...readableCollection("labOrders", me)
      .filter((x: any) => ids.has(x.patientId))
      .map((x: any) => ({
        id: x.id,
        patientId: x.patientId,
        date: x.orderedAt,
        category: "Laboratory",
        description: x.test,
        status: x.status,
      })),
  ];
  return ok(res, { patients: p, rows });
});
api.get("/medical-records/:patientId", (req, res) => {
  const me = requireIdentity(req),
    patientId = idSchema.parse(req.params.patientId),
    patient = requireRecord("patients", patientId);
  if (!["Clinic Administrator", "Doctor", "Patient"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "The medical-record timeline is not available to this role.",
    );
  if (me.role === "Patient" && patientId !== me.patientId)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Patients may access only their own medical records.",
    );
  if (
    ![
      "Patient",
      "Doctor",
      "Clinic Administrator",
      "Laboratory Technician",
      "Pharmacist",
    ].includes(me.role)
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Medical record access is not available for this role.",
    );
  if (me.role === "Doctor" && !scopedPatientIds(me).has(patientId))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "No assigned clinical relationship exists for this patient.",
    );
  const consultations = store
    .list("consultations")
    .filter(
      (x: any) =>
        x.patientId === patientId && canReadRecord("consultations", x, me),
    );
  const prescriptions = store
    .list("prescriptions")
    .filter(
      (x: any) =>
        x.patientId === patientId && canReadRecord("prescriptions", x, me),
    );
  const labs = store
    .list("labOrders")
    .filter(
      (x: any) =>
        x.patientId === patientId && canReadRecord("labOrders", x, me),
    );
  return ok(res, { patient, consultations, prescriptions, labOrders: labs });
});

// Specialized inventory, prescription and procurement transactions.
api.post("/prescriptions/:id/dispense", (req, res) => {
  const me = requireIdentity(req);
  if (me.role !== "Pharmacist")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Pharmacist may dispense prescriptions.",
    );
  const result = workflows.dispensePrescription(
    idSchema.parse(req.params.id),
    me,
  );
  return ok(res, result);
});
api.post("/medicines/:id/stock-adjustments", (req, res) => {
  const me = requireIdentity(req);
  if (!["Clinic Administrator", "Pharmacist"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Inventory adjustments require Pharmacist or Administrator.",
    );
  const id = idSchema.parse(req.params.id),
    b = z
      .object({
        change: z
          .number()
          .int()
          .refine((n) => n !== 0),
        note: z.string().trim().min(1).max(500),
      })
      .parse(getBody(req));
  const m = transaction(() => {
    const medicine = requireRecord("medicines", id);
    if (!medicine.active)
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Archived medicines cannot be adjusted.",
      );
    if (medicine.stock + b.change < 0)
      throw new ApiError(
        409,
        "INSUFFICIENT_STOCK",
        "Stock cannot be adjusted below zero.",
      );
    medicine.stock += b.change;
    store.put("medicines", medicine);
    audit(
      me,
      "Stock adjustment",
      "Inventory",
      id,
      `${b.change > 0 ? "+" : ""}${b.change} units. ${b.note}`,
    );
    return medicine;
  });
  return ok(res, m);
});
api.post("/procurement/:id/receive", (req, res) => {
  const me = requireIdentity(req);
  if (!["Clinic Administrator", "Pharmacist"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Procurement receiving requires Pharmacist or Administrator.",
    );
  const result = workflows.receiveProcurement(
    idSchema.parse(req.params.id),
    me,
  );
  return ok(res, result);
});
api.post("/invoices/:id/payments", (req, res) => {
  const me = requireIdentity(req);
  if (!["Receptionist", "Clinic Administrator"].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Billing payments require Receptionist or Administrator.",
    );
  const id = idSchema.parse(req.params.id),
    b = z
      .object({
        amount: z.number().finite().gt(0),
        method: z.string().trim().max(80).optional(),
        reference: z.string().trim().max(120).optional(),
      })
      .parse(getBody(req));
  const invoice = workflows.recordInvoicePayment(id, b.amount, me, b.method);
  return ok(res, invoice);
});

// Reports support JSON data, print-friendly HTML, PDF, XLSX and CSV output.
api.get("/reports/:kind", (req, res) => {
  const me = requireIdentity(req);
  if (
    !["Clinic Administrator", "Receptionist"].includes(me.role) ||
    (req.params.kind === "financial" && me.role !== "Clinic Administrator")
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "This report is not available to your role.",
    );
  const kind = req.params.kind;
  if (!["financial", "operational"].includes(kind))
    throw new ApiError(404, "NOT_FOUND", "Report type was not found.");
  const from = text(req.query.from),
    to = text(req.query.to);
  if (
    (from && !isoDate(from)) ||
    (to && !isoDate(to)) ||
    (from && to && from > to)
  )
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Report date range must use YYYY-MM-DD and from must not follow to.",
    );
  const within = (d: string) => (!from || d >= from) && (!to || d <= to);
  let rows: any[] = [];
  if (kind === "financial") {
    const names = new Map(
      store.list("patients").map((p: any) => [p.id, p.name]),
    );
    rows = store
      .list("invoices")
      .filter((i: any) => within(i.issuedAt))
      .map((i: any) => ({
        Invoice: i.id,
        Patient: names.get(i.patientId) ?? "Patient",
        "Issued date": i.issuedAt,
        Description: i.description,
        Total: formatINRPaise(rupeesToPaise(i.total)),
        Paid: formatINRPaise(rupeesToPaise(i.paid)),
        Balance: formatINRPaise(rupeesToPaise(i.total) - rupeesToPaise(i.paid)),
        Status: i.status,
      }));
  } else {
    rows = [
      {
        Area: "Patient registrations",
        "Records in period": store
          .list("patients")
          .filter((x: any) => within(x.registeredAt)).length,
        "Current status": "Active and inactive patient records",
      },
      {
        Area: "Appointments",
        "Records in period": store
          .list("appointments")
          .filter((x: any) => within(x.date)).length,
        "Current status": "Workflow states included",
      },
      {
        Area: "Consultations",
        "Records in period": store
          .list("consultations")
          .filter((x: any) => within(x.date)).length,
        "Current status": "Waiting, in progress, and completed",
      },
      {
        Area: "Laboratory orders",
        "Records in period": store
          .list("labOrders")
          .filter((x: any) => within(x.orderedAt)).length,
        "Current status": "Ordered through Reviewed",
      },
      {
        Area: "Prescriptions",
        "Records in period": store
          .list("prescriptions")
          .filter((x: any) => within(x.date)).length,
        "Current status": "Pending through Dispensed",
      },
      {
        Area: "Pharmacy dispensing",
        "Records in period": store
          .list("prescriptions")
          .filter((x: any) => within(x.date) && x.status === "Dispensed")
          .length,
        "Current status": "Fulfilled prescription count",
      },
      {
        Area: "Procurement",
        "Records in period": store
          .list("procurement")
          .filter((x: any) => within(x.createdAt)).length,
        "Current status": "Draft through Received",
      },
      {
        Area: "Low/out-of-stock medicines",
        "Records in period": store
          .list("medicines")
          .filter(
            (x: any) =>
              x.active && (x.stock === 0 || x.stock <= x.minimumStock),
          ).length,
        "Current status": "Current inventory snapshot",
      },
    ];
  }
  const format = text(req.query.format) || "json";
  if (format === "json") return ok(res, { kind, from, to, rows });
  if (format === "print") {
    const htmlEscape = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    return res
      .type("html")
      .send(
        `<html><head><title>Careflow ${htmlEscape(kind)} report</title></head><body><h1>Careflow Clinic ERP — ${htmlEscape(kind)} report</h1><p>${htmlEscape(from || "All dates")} to ${htmlEscape(to || "Today")}</p><pre>${htmlEscape(JSON.stringify(rows, null, 2))}</pre><script>window.print()</script></body></html>`,
      );
  }
  if (format === "csv") {
    const keys = Object.keys(rows[0] ?? { Message: "No matching records" });
    const csvCell = (value: unknown) => {
      const text = String(value ?? "");
      const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const csv = [keys, ...rows.map((r) => keys.map((k) => String(r[k] ?? "")))]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    res.type("text/csv").attachment(`${kind}-report.csv`).send(csv);
    return;
  }
  if (format === "xlsx" || format === "pdf") {
    // Keep optional export libraries lazy-loaded, so the JSON API has no export cost.
    if (format === "xlsx") {
      const headers = Object.keys(
        rows[0] ?? { Message: "No matching records" },
      );
      const xmlSafe = (value: string) => {
        let out = "";
        for (const ch of value) {
          const cp = ch.codePointAt(0)!;
          out +=
            cp === 0x9 ||
            cp === 0xa ||
            cp === 0xd ||
            (cp >= 0x20 && cp <= 0xd7ff) ||
            (cp >= 0xe000 && cp <= 0xfffd) ||
            (cp >= 0x10000 && cp <= 0x10ffff)
              ? ch
              : "�";
        }
        return out;
      };
      const esc = (v: unknown) =>
        xmlSafe(String(v ?? ""))
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('\"', "&quot;")
          .replaceAll("'", "&apos;");
      const col = (n: number) => {
        let x = "";
        for (n++; n; n = Math.floor((n - 1) / 26))
          x = String.fromCharCode(65 + ((n - 1) % 26)) + x;
        return x;
      };
      const matrix = [
        headers,
        ...rows.map((r: any) => headers.map((k) => r[k] ?? "")),
      ];
      const sheetRows = matrix
        .map(
          (row: any[], ri) =>
            `<row r="${ri + 1}">${row
              .map((v: any, ci) => {
                const ref = col(ci) + (ri + 1);
                return typeof v === "number" && Number.isFinite(v)
                  ? `<c r="${ref}"><v>${v}</v></c>`
                  : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
              })
              .join("")}</row>`,
        )
        .join("");
      const xlsx = zipSync({
        "[Content_Types].xml": strToU8(
          '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ),
        "_rels/.rels": strToU8(
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        "xl/workbook.xml": strToU8(
          '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' +
            (kind === "financial" ? "Financial report" : "Operations") +
            '" sheetId="1" r:id="rId1"/></sheets></workbook>',
        ),
        "xl/_rels/workbook.xml.rels": strToU8(
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        "xl/worksheets/sheet1.xml": strToU8(
          '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
            sheetRows +
            "</sheetData></worksheet>",
        ),
      });
      res
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .attachment(`${kind}-report.xlsx`)
        .send(Buffer.from(xlsx));
      return;
    }
    import("pdfkit")
      .then(({ default: PDFDocument }) => {
        const doc = new PDFDocument({
          size: "A4",
          layout: "landscape",
          margin: 36,
        });
        const chunks: Buffer[] = [];
        doc.on("data", (x: Buffer) => chunks.push(x));
        doc.on("end", () =>
          res
            .type("application/pdf")
            .attachment(`${kind}-report.pdf`)
            .send(Buffer.concat(chunks)),
        );
        doc.fontSize(18).text(`Careflow Clinic ERP — ${kind} report`);
        doc
          .moveDown()
          .fontSize(9)
          .text(`Period: ${from || "All dates"} – ${to || "Today"}`);
        doc.moveDown();
        const rupeeFont = resolve(
          process.cwd(),
          "assets/NotoSansDevanagari-Regular.ttf",
        );
        doc.registerFont("CareflowRupee", rupeeFont);
        for (const row of rows) {
          const entries = Object.entries(row);
          entries.forEach(([key, value], index) => {
            doc
              .font("Helvetica")
              .fontSize(8)
              .text(`${index ? "   |   " : ""}${key}: `, { continued: true });
            doc
              .font(
                ["Total", "Paid", "Balance"].includes(key)
                  ? "CareflowRupee"
                  : "Helvetica",
              )
              .fontSize(8)
              .text(String(value), { continued: index < entries.length - 1 });
          });
          doc.text("", { continued: false });
        }
        doc.end();
      })
      .catch(() =>
        fail(res, 501, "EXPORT_UNAVAILABLE", "PDF export is not installed."),
      );
    return;
  }
  throw new ApiError(
    422,
    "VALIDATION_ERROR",
    "format must be json, print, csv, pdf, or xlsx.",
  );
});

// Generic entity facade endpoints, with per-resource role policies and field allowlists.
const readRoles: Record<Collection, Role[]> = {
  patients: roles as unknown as Role[],
  appointments: ["Clinic Administrator", "Receptionist", "Doctor", "Patient"],
  availabilityBlocks: [
    "Clinic Administrator",
    "Receptionist",
    "Doctor",
    "Patient",
  ],
  consultations: ["Clinic Administrator", "Doctor", "Patient"],
  prescriptions: ["Clinic Administrator", "Doctor", "Pharmacist", "Patient"],
  labOrders: [
    "Clinic Administrator",
    "Laboratory Technician",
    "Doctor",
    "Patient",
  ],
  medicines: ["Clinic Administrator", "Pharmacist", "Doctor"],
  suppliers: ["Clinic Administrator", "Pharmacist"],
  procurement: ["Clinic Administrator", "Pharmacist"],
  invoices: ["Clinic Administrator", "Receptionist", "Patient"],
  users: ["Clinic Administrator", "Receptionist"],
  audit: ["Clinic Administrator"],
  notifications: roles as unknown as Role[],
  settings: ["Clinic Administrator"],
};
const createRoles: Record<Collection, Role[]> = {
  patients: ["Clinic Administrator", "Receptionist"],
  appointments: [],
  availabilityBlocks: [
    "Clinic Administrator",
    "Receptionist",
    "Doctor",
    "Patient",
  ],
  consultations: ["Doctor"],
  prescriptions: ["Doctor"],
  labOrders: ["Doctor"],
  medicines: ["Clinic Administrator", "Pharmacist"],
  suppliers: ["Clinic Administrator", "Pharmacist"],
  procurement: ["Clinic Administrator", "Pharmacist"],
  invoices: ["Clinic Administrator", "Receptionist"],
  users: ["Clinic Administrator"],
  audit: [],
  notifications: [],
  settings: ["Clinic Administrator"],
};
const updateRoles: Record<Collection, Role[]> = {
  patients: ["Clinic Administrator", "Receptionist"],
  appointments: [],
  availabilityBlocks: [
    "Clinic Administrator",
    "Receptionist",
    "Doctor",
    "Patient",
  ],
  consultations: ["Doctor"],
  prescriptions: ["Doctor", "Pharmacist"],
  labOrders: ["Laboratory Technician", "Doctor"],
  medicines: ["Clinic Administrator", "Pharmacist"],
  suppliers: ["Clinic Administrator", "Pharmacist"],
  procurement: ["Clinic Administrator", "Pharmacist"],
  invoices: ["Clinic Administrator", "Receptionist"],
  users: ["Clinic Administrator"],
  audit: [],
  notifications: [],
  settings: ["Clinic Administrator"],
};
const fields: Record<Collection, string[]> = {
  patients: [
    "name",
    "dateOfBirth",
    "sex",
    "phone",
    "email",
    "bloodGroup",
    "emergencyContact",
    "status",
    "lastVisit",
  ],
  appointments: [],
  availabilityBlocks: [
    "targetType",
    "targetId",
    "date",
    "startTime",
    "endTime",
    "reason",
    "active",
  ],
  consultations: ["appointmentId", "reason", "notes", "status", "date"],
  prescriptions: ["patientId", "provider", "date", "items", "status"],
  labOrders: [
    "patientId",
    "test",
    "priority",
    "assignedTo",
    "status",
    "result",
    "referenceRange",
    "orderedAt",
  ],
  medicines: [
    "code",
    "name",
    "form",
    "strength",
    "minimumStock",
    "expiry",
    "supplierId",
    "unitPrice",
    "active",
  ],
  suppliers: ["name", "contact", "phone", "email", "leadDays", "status"],
  procurement: [
    "supplierId",
    "createdAt",
    "expectedAt",
    "items",
    "status",
    "total",
  ],
  invoices: ["patientId", "issuedAt", "dueAt", "description", "items"],
  users: ["name", "email", "role", "department", "status", "patientId"],
  audit: [],
  notifications: [],
  settings: ["label", "value", "description"],
};
function filterList(collection: Collection, all: any[], req: Request) {
  let rows = all;
  const q = text(req.query.q).toLowerCase();
  const status = text(req.query.status);
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  if (status) rows = rows.filter((r) => r.status === status);
  const sort = text(req.query.sortBy),
    direction = text(req.query.order) === "desc" ? -1 : 1;
  if (sort && rows.every((r) => Object.prototype.hasOwnProperty.call(r, sort)))
    rows = [...rows].sort(
      (a, b) =>
        String(a[sort] ?? "").localeCompare(String(b[sort] ?? "")) * direction,
    );
  const page = Math.max(1, Number(req.query.page) || 1),
    pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 200));
  const total = rows.length;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total },
  };
}
api.get("/:collection", (req, res) => {
  const me = requireIdentity(req),
    collection = req.params.collection as Collection;
  if (!collections.includes(collection))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  if (!readRoles[collection].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot access this resource.",
    );
  if (collection === "appointments") {
    const items = readableCollection(collection, me);
    const out = filterList(collection, items, req);
    return ok(
      res,
      out.rows.map((appointment: any) => ({
        ...appointment,
        noShowEligible: slotHasElapsed(
          appointment.confirmedDate ?? appointment.date,
          appointment.confirmedTime ?? appointment.time,
          30,
        ),
      })),
      200,
      out.meta,
    );
  }
  if (
    collection === "users" &&
    me.role !== "Clinic Administrator" &&
    me.role !== "Receptionist"
  ) {
    const users = readableCollection("users", me).map(recordOfUser);
    const out = filterList(collection, users, req);
    return ok(res, out.rows, 200, out.meta);
  }
  const items = readableCollection(collection, me);
  const out = filterList(collection, items, req);
  return ok(res, out.rows, 200, out.meta);
});
api.get("/:collection/:id", (req, res) => {
  const me = requireIdentity(req),
    collection = req.params.collection as Collection;
  if (!collections.includes(collection))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  if (!readRoles[collection].includes(me.role))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot access this resource.",
    );
  const record = requireRecord(collection, idSchema.parse(req.params.id));
  assertCanRead(collection, record, me);
  const output =
    collection === "users"
      ? recordOfUser(record)
      : collection === "prescriptions" && me.role === "Patient"
        ? patientPrescriptionView(record)
      : collection === "patients" &&
          ["Pharmacist", "Laboratory Technician"].includes(me.role)
        ? {
            id: record.id,
            mrn: record.mrn,
            name: record.name,
            status: record.status,
          }
        : record;
  return ok(res, output);
});
api.post("/:collection", (req, res) => {
  const me = requireIdentity(req),
    collection = req.params.collection as Collection;
  if (!collections.includes(collection))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  if (collection === "appointments")
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "Use POST /api/appointments to submit a Pending Approval request.",
    );
  if (!allowed(me.role, createRoles[collection]))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot create this resource.",
    );
  const body = getBody(req);
  const created = transaction(() => {
    const record: any = {};
    for (const key of fields[collection])
      if (body[key] !== undefined) record[key] = body[key];
    record.id = body.id ? idSchema.parse(body.id) : newId(prefixes[collection]);
    if (store.get(collection, record.id))
      throw new ApiError(
        409,
        "ALREADY_EXISTS",
        "Record identifier already exists.",
      );
    if (collection === "patients") {
      if (
        !text(record.name) ||
        !isoDate(record.dateOfBirth) ||
        !["Female", "Male", "Other"].includes(record.sex) ||
        !text(record.phone) ||
        !text(record.emergencyContact)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Patient name, valid date of birth, sex, phone, and emergency contact are required.",
        );
      record.mrn = `CF-${randomUUID().slice(0, 8).toUpperCase()}`;
      record.registeredAt = new Date().toISOString().slice(0, 10);
      record.lastVisit = "—";
      record.status = "Active";
    }
    if (collection === "availabilityBlocks") {
      const targetType = record.targetType,
        targetId = record.targetId;
      if (
        !["Patient", "Doctor"].includes(targetType) ||
        !isoDate(record.date) ||
        !timePattern.test(record.startTime) ||
        !timePattern.test(record.endTime) ||
        minute(record.startTime) >= minute(record.endTime) ||
        !text(record.reason)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Availability block fields are invalid.",
        );
      if (targetType === "Patient") requireRecord("patients", targetId);
      else {
        const d = requireRecord("users", targetId);
        if (d.role !== "Doctor")
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Doctor target must be a Doctor user.",
          );
      }
      if (
        (me.role === "Patient" &&
          (targetType !== "Patient" || targetId !== me.patientId)) ||
        (me.role === "Doctor" &&
          (targetType !== "Doctor" || targetId !== me.userId))
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "You may create availability blocks only for yourself.",
        );
      record.active = record.active !== false;
      record.createdById = me.userId;
    }
    if (collection === "consultations") {
      const ap = requireRecord("appointments", text(record.appointmentId));
      if (!["Checked In", "In Consultation", "Completed"].includes(ap.status))
        throw new ApiError(
          409,
          "INVALID_STATE",
          "Consultation requires a checked-in or active/completed appointment.",
        );
      if (
        store.list("consultations").some((c: any) => c.appointmentId === ap.id)
      )
        throw new ApiError(
          409,
          "ALREADY_EXISTS",
          "A consultation is already linked to this appointment.",
        );
      if (ap.doctorId !== me.userId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Consultations may be created only for your assigned appointments.",
        );
      record.patientId = ap.patientId;
      record.doctorId = me.userId;
      record.provider = me.name;
      if (record.status !== undefined && record.status !== "Waiting")
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "A consultation must start in Waiting status.",
        );
      record.status = "Waiting";
      if (
        !text(record.reason) ||
        !text(record.notes) ||
        !isoDate(record.date) ||
        !["Waiting", "In Progress", "Completed"].includes(record.status)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Consultation fields are invalid.",
        );
    }
    if (collection === "prescriptions") {
      if (
        !text(record.patientId) ||
        !isoDate(record.date) ||
        !Array.isArray(record.items) ||
        !record.items.length
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Prescription patient, date, and at least one item are required.",
        );
      if (!scopedPatientIds(me).has(record.patientId))
        throw new ApiError(
          403,
          "FORBIDDEN",
          "A prescription can only be created for a patient in your assigned care.",
        );
      record.doctorId = me.userId;
      record.provider = me.name;
      record.status = "Pending";
      record.items.forEach((line: any) => {
        if (
          !store.get("medicines", line.medicineId) ||
          !Number.isInteger(line.quantity) ||
          line.quantity < 1 ||
          !text(line.dose)
        )
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Prescription item is invalid.",
          );
      });
    }
    if (collection === "labOrders") {
      if (!scopedPatientIds(me).has(record.patientId) || !text(record.test))
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Doctor may order tests only for a patient in their care.",
        );
      record.status = "Ordered";
      record.orderedByUserId = me.userId;
      record.orderedAt = record.orderedAt ?? clinicNow().date;
      record.result = "";
      if (record.assignedTo) {
        const matches = store
          .list("users")
          .filter(
            (u: any) =>
              u.role === "Laboratory Technician" &&
              u.status === "Active" &&
              u.name === text(record.assignedTo),
          );
        if (matches.length !== 1)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Select one active Laboratory Technician with a unique name.",
          );
        record.assignedTo = matches[0].name;
        record.assignedToUserId = matches[0].id;
      } else {
        record.assignedTo = "";
        record.assignedToUserId = null;
      }
    }
    if (collection === "medicines") {
      if (
        !text(record.name) ||
        !text(record.form) ||
        !text(record.strength) ||
        !Number.isInteger(Number(body.stock ?? 0)) ||
        Number(body.stock ?? 0) < 0 ||
        !Number.isInteger(Number(record.minimumStock ?? 0)) ||
        Number(record.minimumStock ?? 0) < 0 ||
        !isoDate(record.expiry) ||
        !store.get("suppliers", record.supplierId) ||
        !validRupee(record.unitPrice)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Medicine fields are invalid.",
        );
      record.stock = Number(body.stock ?? 0);
      record.minimumStock = Number(record.minimumStock ?? 0);
      record.unitPrice = Number(record.unitPrice);
      record.code =
        record.code || `MED-${randomUUID().slice(0, 8).toUpperCase()}`;
      if (store.list("medicines").some((m: any) => m.code === record.code))
        throw new ApiError(
          409,
          "ALREADY_EXISTS",
          "Medicine code already exists.",
        );
      record.active = record.active !== false;
      if (record.stock)
        audit(
          me,
          "Initial stock",
          "Inventory",
          record.id,
          `Initial stock of ${record.stock} units.`,
        );
    }
    if (
      collection === "suppliers" &&
      (!text(record.name) ||
        !text(record.contact) ||
        !text(record.phone) ||
        !text(record.email) ||
        !Number.isInteger(Number(record.leadDays)))
    )
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Supplier fields are invalid.",
      );
    if (collection === "procurement") {
      if (
        !store.get("suppliers", record.supplierId) ||
        !Array.isArray(record.items) ||
        !record.items.length ||
        !isoDate(record.createdAt) ||
        !isoDate(record.expectedAt)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Procurement fields are invalid.",
        );
      for (const line of record.items) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Procurement quantities must be positive whole numbers.",
          );
        requireRecord("medicines", line.medicineId);
      }
      record.status = "Draft";
      record.total = paiseToRupees(
        sumLineItemsPaise(
          record.items.map((i: any) => ({
            ...i,
            unitPrice: requireRecord("medicines", i.medicineId).unitPrice,
          })),
        ),
      );
    }
    if (collection === "invoices") {
      if (
        !store.get("patients", record.patientId) ||
        !isoDate(record.issuedAt) ||
        !isoDate(record.dueAt) ||
        !text(record.description) ||
        !Array.isArray(record.items) ||
        record.items.length === 0
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Invoice fields are invalid.",
        );
      for (const line of record.items) {
        if (
          !text(line.description) ||
          !Number.isInteger(line.quantity) ||
          line.quantity < 1 ||
          !validRupee(line.unitPrice) ||
          line.appointmentId !== undefined
        )
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Invoice line items require a description, positive quantity and INR unit amount with at most two decimals.",
          );
      }
      record.total = paiseToRupees(sumLineItemsPaise(record.items));
      if (record.total <= 0)
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Invoice total must be greater than zero.",
        );
      record.paid = 0;
      record.status = "Unpaid";
    }
    if (collection === "users") {
      const role = record.role as Role;
      if (
        role !== "Patient" &&
        (record.patientId === "" || record.patientId === null)
      )
        delete record.patientId;
      if (
        !roles.includes(role) ||
        !text(record.name) ||
        !text(record.email) ||
        !text(record.department)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "User details and one of the six Careflow roles are required.",
        );
      if (role === "Patient") {
        if (!record.patientId)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Patient accounts must link to a patient record.",
          );
        requireRecord("patients", record.patientId);
      }
      record.status = "Active";
      record.lastActive = "";
      const username =
        text(body.username) ||
        text(record.email)
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "");
      let finalUsername = username;
      let n = 1;
      while (
        db
          .prepare("SELECT 1 FROM credentials WHERE username=? COLLATE NOCASE")
          .get(finalUsername)
      )
        finalUsername = `${username}${++n}`;
      const initialPassword = body.password;
      if (
        typeof initialPassword !== "string" ||
        initialPassword.length < 10 ||
        initialPassword.length > 128
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "A new account requires an initial password of 10 to 128 characters.",
        );
      if (role === "Patient" && !record.patientId)
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Patient accounts must link to a patient record.",
        );
      if (role !== "Patient" && record.patientId != null)
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Only Patient accounts may link to a patient record.",
        );
      store.put(collection, record);
      db.prepare(
        "INSERT INTO credentials(user_id,username,password_hash) VALUES(?,?,?)",
      ).run(record.id, finalUsername, bcrypt.hashSync(initialPassword, 10));
      audit(
        me,
        "User created",
        "Administration",
        record.id,
        `Created ${role} account ${finalUsername}.`,
      );
      return { ...record, loginUsername: finalUsername };
    }
    if (
      collection === "settings" &&
      (!text(record.label) || !text(record.value))
    )
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Setting label and value are required.",
      );
    store.put(collection, record);
    audit(
      me,
      `${collection} created`,
      collection,
      record.id,
      `Created ${collection} record.`,
    );
    return record;
  });
  return ok(res, created, 201);
});
api.put("/:collection/:id", (req, res) => {
  const me = requireIdentity(req),
    collection = req.params.collection as Collection;
  if (!collections.includes(collection))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  if (!allowed(me.role, updateRoles[collection]))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot update this resource.",
    );
  const id = idSchema.parse(req.params.id),
    body = getBody(req);
  const updated = transaction(() => {
    const current = requireRecord(collection, id);
    assertCanRead(collection, current, me);
    const patch: any = {};
    for (const k of fields[collection])
      if (body[k] !== undefined) patch[k] = body[k];
    if (collection === "patients") {
      if (patch.name !== undefined && !text(patch.name))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Patient name cannot be empty.",
        );
      if (patch.dateOfBirth !== undefined && !isoDate(patch.dateOfBirth))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Date of birth must be YYYY-MM-DD.",
        );
    }
    if (collection === "appointments")
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "Appointment state changes use the dedicated workflow endpoints.",
      );
    if (collection === "availabilityBlocks") {
      if (
        patch.targetType !== undefined &&
        !["Patient", "Doctor"].includes(patch.targetType)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Availability target type must be Patient or Doctor.",
        );
      if (patch.date !== undefined && !isoDate(patch.date))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Availability date must be a valid YYYY-MM-DD date.",
        );
      if (
        (me.role === "Patient" &&
          (current.targetId !== me.patientId ||
            current.targetType !== "Patient")) ||
        (me.role === "Doctor" &&
          (current.targetId !== me.userId || current.targetType !== "Doctor"))
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "You may change only your own availability blocks.",
        );
      if (!["Clinic Administrator", "Receptionist"].includes(me.role)) {
        delete patch.targetId;
        delete patch.targetType;
      }
      if (patch.active !== undefined) patch.active = Boolean(patch.active);
      if ((patch.targetType ?? current.targetType) === "Patient")
        requireRecord("patients", patch.targetId ?? current.targetId);
      else {
        const target = requireRecord(
          "users",
          patch.targetId ?? current.targetId,
        );
        if (target.role !== "Doctor")
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Availability target must be a Doctor.",
          );
      }
      const start = patch.startTime ?? current.startTime,
        end = patch.endTime ?? current.endTime;
      if (
        !timePattern.test(start) ||
        !timePattern.test(end) ||
        minute(start) >= minute(end)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Availability block time range is invalid.",
        );
    }
    if (collection === "consultations") {
      if (
        body.appointmentId !== undefined &&
        body.appointmentId !== current.appointmentId
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "A consultation cannot be reassigned to another appointment.",
        );
      if (body.patientId !== undefined && body.patientId !== current.patientId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "A consultation cannot be reassigned to another patient.",
        );
      const ap = requireRecord("appointments", current.appointmentId);
      if (ap.doctorId !== me.userId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the assigned Doctor can edit the consultation.",
        );
      if (
        patch.status &&
        !(
          (current.status === "Waiting" && patch.status === "In Progress") ||
          (current.status === "In Progress" && patch.status === "Completed") ||
          patch.status === current.status
        )
      )
        throw new ApiError(
          409,
          "INVALID_TRANSITION",
          "Consultation status transition is not allowed.",
        );
      delete patch.appointmentId;
      delete patch.patientId;
      delete patch.provider;
      const next = { ...current, ...patch };
      if (
        !text(next.reason) ||
        !text(next.notes) ||
        !isoDate(next.date) ||
        !["Waiting", "In Progress", "Completed"].includes(next.status)
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Consultation reason, notes, date, and status are required.",
        );
    }
    if (collection === "prescriptions") {
      if (!["Doctor", "Pharmacist"].includes(me.role))
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the authoring Doctor or Pharmacy may update an active prescription.",
        );
      if (current.status === "Dispensed" || current.status === "Cancelled")
        throw new ApiError(
          409,
          "INVALID_STATE",
          "A dispensed or cancelled prescription is immutable.",
        );
      if (body.patientId !== undefined && body.patientId !== current.patientId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Prescription patient ownership cannot be changed.",
        );
      delete patch.patientId;
      delete patch.provider;
      delete patch.doctorId;
      if (patch.date !== undefined && !isoDate(patch.date))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Prescription date must be a valid YYYY-MM-DD date.",
        );
      if (me.role === "Doctor" && current.doctorId !== me.userId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Doctor may edit only prescriptions they authored.",
        );
      if (me.role === "Pharmacist") {
        if (Object.keys(patch).some((k) => k !== "status"))
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Pharmacists may change only the pickup status; use dispensing for stock changes.",
          );
      }
      if (patch.items !== undefined) {
        if (me.role !== "Doctor" || current.status !== "Pending")
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Only the authoring Doctor may edit items while a prescription is Pending.",
          );
        if (!Array.isArray(patch.items) || !patch.items.length)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Prescription requires at least one item.",
          );
        const totals = new Map<string, number>();
        for (const line of patch.items) {
          if (
            !store.get("medicines", line.medicineId) ||
            !Number.isInteger(line.quantity) ||
            line.quantity < 1 ||
            !text(line.dose)
          )
            throw new ApiError(
              422,
              "VALIDATION_ERROR",
              "Prescription item is invalid.",
            );
          totals.set(
            line.medicineId,
            (totals.get(line.medicineId) ?? 0) + line.quantity,
          );
        }
      }
      if (patch.status !== undefined) {
        const edges: Record<string, string[]> = {
          Doctor: ["Cancelled"],
          Pharmacist:
            current.status === "Pending"
              ? ["Ready for Pickup", "Cancelled"]
              : ["Cancelled"],
        };
        if (
          patch.status !== current.status &&
          !edges[me.role]?.includes(patch.status)
        )
          throw new ApiError(
            409,
            "INVALID_TRANSITION",
            "Prescription status transition is not allowed; only the dispense transaction can mark it Dispensed.",
          );
      }
    }
    if (collection === "labOrders") {
      if (!["Doctor", "Laboratory Technician"].includes(me.role))
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the ordering Doctor or assigned Laboratory Technician may update a lab order.",
        );
      if (body.patientId !== undefined && body.patientId !== current.patientId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Laboratory order patient ownership cannot be changed.",
        );
      delete patch.patientId;
      delete patch.orderedByUserId;
      if (
        current.status === "Reviewed" &&
        patch.result !== undefined &&
        patch.result !== current.result
      )
        throw new ApiError(
          409,
          "INVALID_STATE",
          "A reviewed laboratory result is immutable.",
        );
      if (patch.status === "Completed" && !text(patch.result ?? current.result))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "A result is required before completing a laboratory order.",
        );
      if (me.role === "Laboratory Technician") {
        if (Object.keys(patch).some((k) => !["status", "result"].includes(k)))
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Laboratory Technicians may update only workflow status and result.",
          );
        if (current.assignedToUserId && current.assignedToUserId !== me.userId)
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Only the assigned Laboratory Technician may update this order.",
          );
        if (!current.assignedToUserId && !current.assignedTo) {
          patch.assignedTo = me.name;
          patch.assignedToUserId = me.userId;
        }
        if (patch.status) {
          const edges: any = {
            Ordered: ["Collected"],
            Collected: ["Processing"],
            Processing: ["Completed"],
            Completed: ["Reviewed"],
            Reviewed: [],
          };
          if (!edges[current.status]?.includes(patch.status))
            throw new ApiError(
              409,
              "INVALID_TRANSITION",
              `Cannot move laboratory order from ${current.status} to ${patch.status}.`,
            );
        }
      } else if (me.role === "Doctor") {
        if (
          patch.status ||
          patch.result ||
          patch.assignedTo ||
          patch.orderedAt ||
          patch.assignedToUserId
        )
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Doctors cannot edit laboratory workflow, results, or assignment.",
          );
        if (current.status !== "Ordered")
          throw new ApiError(
            409,
            "INVALID_STATE",
            "Only unprocessed laboratory orders may be edited by the ordering Doctor.",
          );
        if (
          patch.priority !== undefined &&
          !["Routine", "Urgent"].includes(patch.priority)
        )
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Laboratory priority is invalid.",
          );
        if (patch.test !== undefined && !text(patch.test))
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Laboratory test cannot be empty.",
          );
      }
    }
    if (collection === "medicines") {
      if (body.stock !== undefined)
        throw new ApiError(
          403,
          "STOCK_ENDPOINT_REQUIRED",
          "Use the stock adjustment endpoint; stock cannot be set through catalog edits.",
        );
      const next = { ...current, ...patch };
      if (
        !text(next.name) ||
        !text(next.form) ||
        !text(next.strength) ||
        !Number.isInteger(next.minimumStock) ||
        next.minimumStock < 0 ||
        !isoDate(next.expiry) ||
        !store.get("suppliers", next.supplierId) ||
        !validRupee(next.unitPrice) ||
        typeof next.active !== "boolean"
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Medicine catalog fields are invalid.",
        );
      if (
        patch.code !== undefined &&
        store
          .list("medicines")
          .some((m: any) => m.id !== id && m.code === patch.code)
      )
        throw new ApiError(
          409,
          "ALREADY_EXISTS",
          "Medicine code already exists.",
        );
      patch.minimumStock = Number(next.minimumStock);
      patch.unitPrice = Number(next.unitPrice);
    }
    if (collection === "procurement") {
      if (patch.items !== undefined) {
        if (!Array.isArray(patch.items) || !patch.items.length)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Procurement requires at least one item.",
          );
        for (const line of patch.items) {
          if (!Number.isInteger(line.quantity) || line.quantity < 1)
            throw new ApiError(
              422,
              "VALIDATION_ERROR",
              "Procurement quantities must be positive whole numbers.",
            );
          requireRecord("medicines", line.medicineId);
        }
        patch.total = paiseToRupees(
          sumLineItemsPaise(
            patch.items.map((i: any) => ({
              ...i,
              unitPrice: requireRecord("medicines", i.medicineId).unitPrice,
            })),
          ),
        );
      }
      if (patch.supplierId && !store.get("suppliers", patch.supplierId))
        throw new ApiError(422, "VALIDATION_ERROR", "Supplier was not found.");
      if (patch.expectedAt !== undefined && !isoDate(patch.expectedAt))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Expected date must be a valid YYYY-MM-DD date.",
        );
      if (
        patch.createdAt !== undefined &&
        patch.createdAt !== current.createdAt
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "A purchase order creation date cannot be changed.",
        );
      delete patch.createdAt;
      if (
        patch.expectedAt !== undefined &&
        patch.expectedAt < current.createdAt
      )
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Expected date cannot precede the order creation date.",
        );
      if (
        Object.keys(patch).some((k) => k !== "status") &&
        !["Draft", "Submitted"].includes(current.status)
      )
        throw new ApiError(
          409,
          "INVALID_STATE",
          "Only Draft or Submitted purchase orders may be edited.",
        );
      if (body.status !== undefined) {
        const next = String(body.status);
        const edges: any = {
          Draft: ["Submitted", "Cancelled"],
          Submitted: ["Approved", "Cancelled"],
          Approved: [],
          Received: [],
          Cancelled: [],
        };
        if (!edges[current.status]?.includes(next))
          throw new ApiError(
            409,
            "INVALID_TRANSITION",
            `Cannot change procurement from ${current.status} to ${next}.`,
          );
        patch.status = next;
      }
      if (body.total !== undefined) delete patch.total;
    }
    if (collection === "invoices") {
      if (body.patientId !== undefined && body.patientId !== current.patientId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Invoice patient ownership cannot be changed.",
        );
      delete patch.patientId;
      if (patch.issuedAt !== undefined && !isoDate(patch.issuedAt))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Invoice issue date must be a valid YYYY-MM-DD date.",
        );
      if (patch.dueAt !== undefined && !isoDate(patch.dueAt))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Invoice due date must be a valid YYYY-MM-DD date.",
        );
      const nextIssuedAt = patch.issuedAt ?? current.issuedAt;
      const nextDueAt = patch.dueAt ?? current.dueAt;
      if (nextDueAt < nextIssuedAt)
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Invoice due date cannot precede its issue date.",
        );
      if (
        current.status === "Void" &&
        Object.keys(patch).some((k) => k !== "status")
      )
        throw new ApiError(
          409,
          "INVALID_STATE",
          "Voided invoices are immutable.",
        );
      if (body.status === "Void") {
        patch.status = "Void";
        patch.voidedAt = timestamp();
        patch.voidedById = me.userId;
      } else if (body.paid !== undefined || body.status !== undefined) {
        throw new ApiError(
          403,
          "DEDICATED_WORKFLOW_REQUIRED",
          "Payment status is calculated by the server; only Void may be requested.",
        );
      }
      if (body.total !== undefined)
        throw new ApiError(
          403,
          "LINE_ITEMS_REQUIRED",
          "Invoice totals are calculated from invoice line items and cannot be set directly.",
        );
      if (body.status === "Void" && patch.items !== undefined)
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Voiding an invoice cannot also change line items.",
        );
      if (patch.items !== undefined) {
        if (
          current.items?.some((line: any) => Boolean(line.appointmentId))
        )
          throw new ApiError(
            409,
            "SYSTEM_GENERATED_LINE_IMMUTABLE",
            "Consultation charge lines are managed by the appointment workflow and cannot be replaced.",
          );
        if (!Array.isArray(patch.items) || patch.items.length === 0)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Invoice requires at least one line item.",
          );
        for (const line of patch.items)
          if (
            !text(line.description) ||
            !Number.isInteger(line.quantity) ||
            line.quantity < 1 ||
            !validRupee(line.unitPrice) ||
            line.appointmentId !== undefined
          )
            throw new ApiError(
              422,
              "VALIDATION_ERROR",
              "Invoice line items are invalid.",
            );
        patch.total = paiseToRupees(sumLineItemsPaise(patch.items));
        if (rupeesToPaise(patch.total) < rupeesToPaise(current.paid))
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Invoice total cannot be below payments already recorded.",
          );
        patch.status =
          rupeesToPaise(patch.total) === rupeesToPaise(current.paid)
            ? "Paid"
            : rupeesToPaise(current.paid) > 0
              ? "Part Paid"
              : "Unpaid";
      }
    }
    if (collection === "settings" && id === "consultation-fee") {
      const value = String(patch.value ?? current.value ?? "").trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Consultation fee must be a whole number of paise.",
        );
      try {
        paiseToRupees(Number(value));
      } catch {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Consultation fee exceeds the supported INR amount.",
        );
      }
      patch.value = value;
      patch.updatedById = me.userId;
      patch.updatedAt = timestamp();
    }
    if (collection === "users") {
      if (patch.role !== undefined && !roles.includes(patch.role))
        throw new ApiError(422, "VALIDATION_ERROR", "Role is invalid.");
      const nextRole = patch.role ?? current.role;
      if (
        current.role === "Patient" &&
        nextRole === "Patient" &&
        patch.patientId !== undefined &&
        patch.patientId !== current.patientId
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "A Patient account cannot be reassigned to a different patient record.",
        );
      if (nextRole === "Patient") {
        const nextPatientId = patch.patientId ?? current.patientId;
        if (!nextPatientId)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Patient accounts must remain linked to a patient record.",
          );
        requireRecord("patients", nextPatientId);
        patch.patientId = nextPatientId;
      } else {
        if (body.patientId !== undefined && body.patientId !== null)
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Only Patient accounts may link to a patient record.",
          );
        if (current.role === "Patient") patch.patientId = null;
      }
    }
    Object.assign(current, patch);
    if (collection === "consultations") current.provider = me.name;
    if (
      collection === "users" &&
      (patch.status !== undefined ||
        patch.role !== undefined ||
        patch.patientId !== undefined)
    )
      db.prepare(
        "UPDATE credentials SET token_version=token_version+1 WHERE user_id=?",
      ).run(id);
    store.put(collection, current);
    audit(
      me,
      `${collection} updated`,
      collection,
      id,
      `Updated ${collection} record.`,
    );
    return collection === "users" ? recordOfUser(current) : current;
  });
  return ok(res, updated);
});
api.patch("/:collection/:id/read", (req, res) => {
  const me = requireIdentity(req);
  if (req.params.collection !== "notifications")
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  const id = idSchema.parse(req.params.id),
    item = requireRecord("notifications", id);
  if (!isNotificationVisible(item, me))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You may access only your own notifications.",
    );
  item.read = true;
  store.put("notifications", item);
  return ok(res, item);
});
api.delete("/:collection/:id", (req, res) => {
  const me = requireIdentity(req),
    collection = req.params.collection as Collection;
  if (!collections.includes(collection))
    throw new ApiError(404, "NOT_FOUND", "Resource was not found.");
  if (
    (collection === "patients" &&
      !["Receptionist", "Clinic Administrator"].includes(me.role)) ||
    (collection === "medicines" &&
      !["Clinic Administrator", "Pharmacist"].includes(me.role)) ||
    (collection === "users" && me.role !== "Clinic Administrator") ||
    (collection === "suppliers" &&
      !["Clinic Administrator", "Pharmacist"].includes(me.role)) ||
    (collection === "invoices" &&
      !["Clinic Administrator", "Receptionist"].includes(me.role)) ||
    (collection === "availabilityBlocks" &&
      !["Clinic Administrator", "Receptionist", "Doctor", "Patient"].includes(
        me.role,
      ))
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot archive this resource.",
    );
  const id = idSchema.parse(req.params.id);
  if (collection === "settings" && id === "consultation-fee")
    throw new ApiError(
      409,
      "REQUIRED_SETTING",
      "The consultation fee setting is required and cannot be removed.",
    );
  transaction(() => {
    const item = requireRecord(collection, id);
    if (
      collection === "availabilityBlocks" &&
      !["Clinic Administrator", "Receptionist"].includes(me.role) &&
      !(
        (me.role === "Patient" &&
          item.targetType === "Patient" &&
          item.targetId === me.patientId) ||
        (me.role === "Doctor" &&
          item.targetType === "Doctor" &&
          item.targetId === me.userId)
      )
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "You may archive only your own availability blocks.",
      );
    if (
      collection === "patients" ||
      collection === "users" ||
      collection === "suppliers"
    )
      item.status = "Inactive";
    else if (collection === "medicines") item.active = false;
    else if (collection === "availabilityBlocks") item.active = false;
    else if (collection === "invoices") {
      item.status = "Void";
      item.voidedAt = timestamp();
      item.voidedById = me.userId;
    } else
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "This resource cannot be archived.",
      );
    store.put(collection, item);
    if (collection === "users")
      db.prepare(
        "UPDATE credentials SET token_version=token_version+1 WHERE user_id=?",
      ).run(id);
    audit(
      me,
      `${collection} archived`,
      collection,
      id,
      "Record archived/deactivated; history retained.",
    );
  });
  return res.status(204).end();
});

api.use((req, res) =>
  fail(
    res,
    404,
    "NOT_FOUND",
    `No API route matches ${req.method} ${req.path}.`,
  ),
);
export { api as apiRouter };
