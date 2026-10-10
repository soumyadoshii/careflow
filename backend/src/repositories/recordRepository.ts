import { db, withSavepoint } from "../db/database.js";
import { paiseToRupees, rupeesToPaise } from "../domain/money.js";
export const collections = [
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
export type Collection = (typeof collections)[number];
export interface InvoicePaymentInput {
  id: string;
  invoiceId: string;
  amountPaise: number;
  method?: string;
  reference?: string;
  recordedByUserId?: string;
  recordedAt: string;
  entryKind?: "opening_balance" | "payment";
}
export interface DispensingInvoiceInput {
  id: string;
  patientId: string;
  prescriptionId: string;
  issuedAt: string;
  dueAt: string;
  createdAt: string;
  items: { medicineId: string; quantity: number }[];
}
export interface ConsultationChargeInput {
  appointmentId: string;
  patientId: string;
  feePaise: number;
  issuedAt: string;
  dueAt: string;
  createdAt: string;
}
export interface RecordRepository {
  list(collection: string): any[];
  get(collection: string, id: string): any | undefined;
  put(collection: string, value: any): void;
  remove(collection: string, id: string): void;
  count(collection: string): number;
  clear(): void;
  addInvoicePayment(payment: InvoicePaymentInput): void;
  addDispensingInvoice(invoice: DispensingInvoiceInput): void;
  addConsultationCharge(charge: ConsultationChargeInput): { invoiceId: string };
}
const fields: Record<Collection, string[]> = {
  patients: [
    "mrn",
    "name",
    "dateOfBirth",
    "sex",
    "phone",
    "email",
    "bloodGroup",
    "emergencyContact",
    "registeredAt",
    "lastVisit",
    "status",
    "createdAt",
    "updatedAt",
  ],
  appointments: [
    "patientId",
    "doctorId",
    "provider",
    "department",
    "date",
    "time",
    "requestedDate",
    "requestedTime",
    "confirmedDate",
    "confirmedTime",
    "proposedDate",
    "proposedTime",
    "type",
    "reason",
    "requestedById",
    "requestedByName",
    "requestedByRole",
    "createdAt",
    "updatedAt",
    "approvedById",
    "approvedByName",
    "rejectionReason",
    "cancellationReason",
    "cancellationRequestedAt",
    "cancellationRequestedById",
    "cancellationRequestedByName",
    "cancellationRequestedByRole",
    "rescheduleRequestedAt",
    "rescheduleRequestedById",
    "rescheduleRequestedByName",
    "rescheduleRequestedByRole",
    "proposalById",
    "proposalByName",
    "proposalAcceptedById",
    "proposalAcceptedAt",
    "status",
  ],
  availabilityBlocks: [
    "targetType",
    "targetId",
    "date",
    "startTime",
    "endTime",
    "reason",
    "active",
    "createdById",
  ],
  consultations: [
    "appointmentId",
    "patientId",
    "doctorId",
    "provider",
    "reason",
    "notes",
    "status",
    "date",
    "createdAt",
    "updatedAt",
  ],
  prescriptions: [
    "patientId",
    "doctorId",
    "provider",
    "date",
    "status",
    "dispensedAt",
    "dispensedById",
    "createdAt",
    "updatedAt",
  ],
  labOrders: [
    "patientId",
    "orderedByUserId",
    "test",
    "orderedAt",
    "priority",
    "assignedTo",
    "assignedToUserId",
    "status",
    "result",
    "referenceRange",
    "createdAt",
    "updatedAt",
  ],
  medicines: [
    "code",
    "name",
    "form",
    "strength",
    "stock",
    "minimumStock",
    "expiry",
    "supplierId",
    "unitPrice",
    "active",
    "createdAt",
    "updatedAt",
  ],
  suppliers: [
    "name",
    "contact",
    "phone",
    "email",
    "leadDays",
    "status",
    "createdAt",
    "updatedAt",
  ],
  procurement: [
    "supplierId",
    "createdAt",
    "expectedAt",
    "status",
    "total",
    "receivedAt",
    "receivedById",
    "createdById",
    "updatedAt",
  ],
  invoices: [
    "patientId",
    "issuedAt",
    "dueAt",
    "description",
    "total",
    "paid",
    "status",
    "voidedById",
    "voidedAt",
    "createdAt",
    "updatedAt",
  ],
  users: [
    "name",
    "email",
    "role",
    "department",
    "status",
    "lastActive",
    "patientId",
    "createdAt",
    "updatedAt",
  ],
  audit: [
    "at",
    "actor",
    "actorUserId",
    "role",
    "action",
    "area",
    "recordId",
    "details",
  ],
  notifications: [
    "role",
    "recipientId",
    "patientId",
    "title",
    "message",
    "at",
    "href",
    "read",
  ],
  settings: ["label", "value", "description", "updatedById", "updatedAt"],
};
const tables: Record<Collection, string> = {
  patients: "patients",
  appointments: "appointments",
  availabilityBlocks: "availability_blocks",
  consultations: "consultations",
  prescriptions: "prescriptions",
  labOrders: "lab_orders",
  medicines: "medicines",
  suppliers: "suppliers",
  procurement: "procurement_orders",
  invoices: "invoices",
  users: "users",
  audit: "audit",
  notifications: "notifications",
  settings: "settings",
};
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const bools = new Set(["active", "read"]);
function assertCollection(c: string): asserts c is Collection {
  if (!(collections as readonly string[]).includes(c))
    throw new Error("Unknown record collection.");
}
function col(c: Collection, k: string) {
  if (c === "medicines" && k === "unitPrice") return "unit_price_paise";
  if (c === "invoices" && k === "total") return "total_paise";
  if (c === "invoices" && k === "paid") return "paid_paise";
  if (c === "procurement" && k === "total") return "total_paise";
  if (c === "availabilityBlocks" && k === "targetType") return "target_type";
  if (c === "availabilityBlocks" && k === "targetId") return "__target_id";
  return snake(k);
}
function val(c: Collection, k: string, v: any) {
  if (v === undefined) return null;
  if (
    (c === "medicines" && k === "unitPrice") ||
    (c === "invoices" && (k === "total" || k === "paid")) ||
    (c === "procurement" && k === "total")
  )
    return rupeesToPaise(v);
  if (bools.has(k)) return v ? 1 : 0;
  return v;
}
function from(c: Collection, k: string, v: any) {
  if (v === null || v === undefined) return undefined;
  if (
    (c === "medicines" && k === "unitPrice") ||
    (c === "invoices" && (k === "total" || k === "paid")) ||
    (c === "procurement" && k === "total")
  )
    return paiseToRupees(Number(v));
  if (bools.has(k)) return Boolean(v);
  return v;
}
function resolve(c: Collection, r: any) {
  const x = { ...r };
  if (c === "availabilityBlocks") {
    x.patientId = r.targetType === "Patient" ? r.targetId : null;
    x.doctorId = r.targetType === "Doctor" ? r.targetId : null;
  }
  const uniqueActiveUserId = (role: string, name: string) => {
    if (!name) return undefined;
    const matches = db
      .prepare(
        "SELECT id FROM users WHERE role=? AND name=? AND status='Active'",
      )
      .all(role, name) as any[];
    return matches.length === 1 ? matches[0].id : undefined;
  };
  if ((c === "consultations" || c === "prescriptions") && !x.doctorId)
    x.doctorId = uniqueActiveUserId("Doctor", r.provider);
  if (c === "labOrders" && !x.assignedToUserId)
    x.assignedToUserId =
      uniqueActiveUserId("Laboratory Technician", r.assignedTo) ?? null;
  if (c === "audit" && !x.actorUserId) {
    const matches = db
      .prepare("SELECT id FROM users WHERE name=? AND status='Active'")
      .all(r.actor) as any[];
    x.actorUserId = matches.length === 1 ? matches[0].id : null;
  }
  return x;
}
function toEntity(c: Collection, r: any): any {
  const out: any = { id: r.id };
  for (const k of fields[c]) {
    if (c === "availabilityBlocks" && k === "targetType") {
      out.targetType = r.target_type;
      continue;
    }
    if (c === "availabilityBlocks" && k === "targetId") {
      const v = r[r.target_type === "Patient" ? "patient_id" : "doctor_id"];
      if (v != null) out.targetId = v;
      continue;
    }
    const v = from(c, k, r[col(c, k)]);
    if (v !== undefined) out[k] = v;
  }
  if (c === "prescriptions")
    out.items = db
      .prepare(
        "SELECT medicine_id,dose,quantity,instructions FROM prescription_items WHERE prescription_id=? ORDER BY line_no",
      )
      .all(r.id)
      .map((x: any) => ({
        medicineId: x.medicine_id,
        dose: x.dose,
        quantity: x.quantity,
        instructions: x.instructions,
      }));
  if (c === "procurement")
    out.items = db
      .prepare(
        "SELECT medicine_id,quantity FROM procurement_items WHERE procurement_id=? ORDER BY line_no",
      )
      .all(r.id)
      .map((x: any) => ({ medicineId: x.medicine_id, quantity: x.quantity }));
  if (c === "invoices") {
    out.balance = paiseToRupees(Number(r.total_paise) - Number(r.paid_paise));
    out.items = db
      .prepare(
        "SELECT description,quantity,unit_amount_paise,amount_paise,appointment_id FROM invoice_items WHERE invoice_id=? ORDER BY line_no",
      )
      .all(r.id)
      .map((x: any) => ({
        description: x.description,
        quantity: x.quantity,
        unitPrice: paiseToRupees(Number(x.unit_amount_paise)),
        amount: paiseToRupees(Number(x.amount_paise)),
        ...(x.appointment_id ? { appointmentId: x.appointment_id } : {}),
      }));
  }
  return out;
}
function consultationFeeSetting(): any {
  const setting = db
    .prepare(
      "SELECT setting_key,label,value_paise,description,updated_by_id,updated_at FROM clinic_billing_settings WHERE setting_key='consultation-fee'",
    )
    .get() as any;
  return setting
    ? {
        id: setting.setting_key,
        label: setting.label,
        value: String(setting.value_paise),
        description: setting.description,
        ...(setting.updated_by_id ? { updatedById: setting.updated_by_id } : {}),
        ...(setting.updated_at ? { updatedAt: setting.updated_at } : {}),
      }
    : undefined;
}
function saveChildren(c: Collection, r: any, isNew: boolean) {
  if (c === "prescriptions" && Array.isArray(r.items)) {
    db.prepare("DELETE FROM prescription_items WHERE prescription_id=?").run(
      r.id,
    );
    r.items.forEach((x: any, i: number) =>
      db
        .prepare(
          "INSERT INTO prescription_items(id,prescription_id,line_no,medicine_id,dose,quantity,instructions) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          `${r.id}-line-${i + 1}`,
          r.id,
          i,
          x.medicineId,
          x.dose,
          x.quantity,
          x.instructions ?? "",
        ),
    );
  }
  if (c === "procurement" && Array.isArray(r.items)) {
    db.prepare("DELETE FROM procurement_items WHERE procurement_id=?").run(
      r.id,
    );
    r.items.forEach((x: any, i: number) => {
      const m = db
        .prepare("SELECT unit_price_paise FROM medicines WHERE id=?")
        .get(x.medicineId) as any;
      if (!m) throw new Error("Unknown medicine in procurement item.");
      db.prepare(
        "INSERT INTO procurement_items(id,procurement_id,line_no,medicine_id,quantity,unit_price_paise) VALUES (?,?,?,?,?,?)",
      ).run(
        `${r.id}-line-${i + 1}`,
        r.id,
        i,
        x.medicineId,
        x.quantity,
        m.unit_price_paise,
      );
    });
  }
  if (c === "invoices" && (isNew || Array.isArray(r.items))) {
    db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(r.id);
    const lines =
      Array.isArray(r.items) && r.items.length
        ? r.items
        : [{ description: r.description, quantity: 1, unitPrice: r.total }];
    lines.forEach((x: any, i: number) => {
      const u = rupeesToPaise(x.unitPrice ?? x.amount ?? r.total),
        q = Number(x.quantity ?? 1);
      db.prepare(
        "INSERT INTO invoice_items(id,invoice_id,line_no,description,quantity,unit_amount_paise,amount_paise,appointment_id) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        `${r.id}-line-${i + 1}`,
        r.id,
        i,
        x.description ?? r.description,
        q,
        u,
        u * q,
        x.appointmentId ?? null,
      );
    });
  }
}
export const records: RecordRepository = {
  list(c) {
    assertCollection(c);
    const rows = (
      db.prepare(`SELECT * FROM ${tables[c]} ORDER BY rowid`).all() as any[]
    ).map((r) => toEntity(c, r));
    if (c === "settings") {
      const fee = consultationFeeSetting();
      if (fee) rows.push(fee);
    }
    return rows;
  },
  get(c, id) {
    assertCollection(c);
    if (c === "settings" && id === "consultation-fee")
      return consultationFeeSetting();
    const r = db.prepare(`SELECT * FROM ${tables[c]} WHERE id=?`).get(id);
    return r ? toEntity(c, r) : undefined;
  },
  put(c, r) {
    assertCollection(c);
    if (c === "settings" && r.id === "consultation-fee") {
      const raw = String(r.value ?? "").trim();
      if (!/^\d+$/.test(raw))
        throw new Error("Consultation fee must be a whole number of paise.");
      const valuePaise = Number(raw);
      if (!Number.isSafeInteger(valuePaise))
        throw new Error("Consultation fee exceeds the supported paise limit.");
      paiseToRupees(valuePaise);
      db.prepare(
        "UPDATE clinic_billing_settings SET label=?,value_paise=?,description=?,updated_by_id=?,updated_at=? WHERE setting_key='consultation-fee'",
      ).run(
        r.label ?? "Consultation fee",
        valuePaise,
        r.description ?? "",
        r.updatedById ?? null,
        r.updatedAt ?? null,
      );
      return;
    }
    withSavepoint(() => {
      const t = tables[c],
        x = resolve(c, r),
        keys =
          c === "availabilityBlocks"
            ? [
                "id",
                "targetType",
                "patientId",
                "doctorId",
                "date",
                "startTime",
                "endTime",
                "reason",
                "active",
                "createdById",
              ]
            : ["id", ...fields[c]],
        cols = keys.map((k) =>
          c === "availabilityBlocks" ? snake(k) : col(c, k),
        ),
        values = keys.map((k) => val(c, k, x[k]));
      const existed = db.prepare(`SELECT 1 FROM ${t} WHERE id=?`).get(r.id);
      const updates = cols
        .slice(1)
        .map((k) => `${k}=excluded.${k}`)
        .join(",");
      db.prepare(
        `INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
      ).run(...values);
      if (c === "invoices" && !existed && Number(r.paid) > 0) {
        const p = rupeesToPaise(r.paid);
        db.prepare(
          "INSERT INTO invoice_payments(id,invoice_id,amount_paise,method,reference,recorded_at,entry_kind) VALUES(?,?,?,?,?,?,?)",
        ).run(
          `${r.id}-opening`,
          r.id,
          p,
          "Opening balance",
          "",
          r.issuedAt,
          "opening_balance",
        );
      }
      saveChildren(c, r, !existed);
    });
  },
  remove(c, id) {
    assertCollection(c);
    if (c === "settings" && id === "consultation-fee")
      throw new Error("The consultation fee setting cannot be removed.");
    db.prepare(`DELETE FROM ${tables[c]} WHERE id=?`).run(id);
  },
  count(c) {
    assertCollection(c);
    const count = Number(
      (db.prepare(`SELECT count(*) n FROM ${tables[c]}`).get() as any).n,
    );
    return count + (c === "settings" && consultationFeeSetting() ? 1 : 0);
  },
  clear() {
    withSavepoint(() => {
      for (const t of [
        "invoice_payments",
        "invoice_items",
        "procurement_items",
        "prescription_items",
        "notifications",
        "audit",
        "settings",
        "invoices",
        "procurement_orders",
        "lab_orders",
        "prescriptions",
        "consultations",
        "availability_blocks",
        "appointments",
        "medicines",
        "suppliers",
        "credentials",
        "preferences",
        "users",
        "patients",
      ])
        db.exec(`DELETE FROM ${t}`);
    });
  },
  addInvoicePayment(p) {
    db.prepare(
      "INSERT INTO invoice_payments(id,invoice_id,amount_paise,method,reference,recorded_by_user_id,recorded_at,entry_kind) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      p.id,
      p.invoiceId,
      p.amountPaise,
      p.method ?? "",
      p.reference ?? "",
      p.recordedByUserId ?? null,
      p.recordedAt,
      p.entryKind ?? "payment",
    );
  },
  addDispensingInvoice(invoice) {
    if (!invoice.items.length)
      throw new Error("A medication invoice requires at least one line.");
    const getMedicine = db.prepare(
      "SELECT name,strength,unit_price_paise FROM medicines WHERE id=?",
    );
    const lines = invoice.items.map((item) => {
      if (!Number.isInteger(item.quantity) || item.quantity < 1)
        throw new Error("Medication invoice quantities must be positive integers.");
      const medicine = getMedicine.get(item.medicineId) as any;
      if (!medicine) throw new Error("Medicine for dispensing invoice was not found.");
      const unitPricePaise = Number(medicine.unit_price_paise);
      const amountPaise = unitPricePaise * item.quantity;
      if (!Number.isSafeInteger(unitPricePaise) || !Number.isSafeInteger(amountPaise))
        throw new Error("Medication invoice amount exceeds the safe INR limit.");
      return {
        description: `${medicine.name} ${medicine.strength}`.trim(),
        quantity: item.quantity,
        unitPricePaise,
        amountPaise,
      };
    });
    const totalPaise = lines.reduce((total, line) => total + line.amountPaise, 0);
    if (!Number.isSafeInteger(totalPaise))
      throw new Error("Medication invoice total exceeds the safe INR limit.");
    const consultationInvoice = db
      .prepare(
        `SELECT i.id,i.total_paise,i.paid_paise FROM invoices i
         WHERE i.patient_id=? AND i.status IN ('Unpaid','Part Paid')
           AND EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.appointment_id IS NOT NULL)
         ORDER BY i.issued_at DESC,i.rowid DESC LIMIT 1`,
      )
      .get(invoice.patientId) as any;
    if (consultationInvoice) {
      const firstLine = Number(
        (
          db
            .prepare(
              "SELECT COALESCE(MAX(line_no),-1)+1 AS next_line FROM invoice_items WHERE invoice_id=?",
            )
            .get(consultationInvoice.id) as any
        ).next_line,
      );
      const insertLine = db.prepare(
        "INSERT INTO invoice_items(id,invoice_id,line_no,description,quantity,unit_amount_paise,amount_paise) VALUES(?,?,?,?,?,?,?)",
      );
      lines.forEach((line, index) =>
        insertLine.run(
          `${invoice.id}-line-${index + 1}`,
          consultationInvoice.id,
          firstLine + index,
          line.description,
          line.quantity,
          line.unitPricePaise,
          line.amountPaise,
        ),
      );
      const nextTotal = Number(consultationInvoice.total_paise) + totalPaise;
      paiseToRupees(nextTotal);
      const paid = Number(consultationInvoice.paid_paise);
      const status = paid === 0 ? "Unpaid" : paid >= nextTotal ? "Paid" : "Part Paid";
      db.prepare(
        "UPDATE invoices SET total_paise=?,status=?,updated_at=? WHERE id=?",
      ).run(nextTotal, status, invoice.createdAt, consultationInvoice.id);
      return;
    }
    const status = totalPaise === 0 ? "Paid" : "Unpaid";
    db.prepare(
      "INSERT INTO invoices(id,patient_id,issued_at,due_at,description,total_paise,paid_paise,status,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?,?)",
    ).run(
      invoice.id,
      invoice.patientId,
      invoice.issuedAt,
      invoice.dueAt,
      `Medication dispensing · prescription ${invoice.prescriptionId}`,
      totalPaise,
      status,
      invoice.createdAt,
      invoice.createdAt,
    );
    const insertLine = db.prepare(
      "INSERT INTO invoice_items(id,invoice_id,line_no,description,quantity,unit_amount_paise,amount_paise) VALUES(?,?,?,?,?,?,?)",
    );
    lines.forEach((line, index) =>
      insertLine.run(
        `${invoice.id}-line-${index + 1}`,
        invoice.id,
        index,
        line.description,
        line.quantity,
        line.unitPricePaise,
        line.amountPaise,
      ),
    );
  },
  addConsultationCharge(charge) {
    if (!Number.isSafeInteger(charge.feePaise) || charge.feePaise < 0)
      throw new Error("Consultation fee must be a non-negative integer amount of paise.");
    paiseToRupees(charge.feePaise);
    const existing = db
      .prepare(
        "SELECT invoice_id FROM invoice_items WHERE appointment_id=? LIMIT 1",
      )
      .get(charge.appointmentId) as any;
    if (existing) return { invoiceId: existing.invoice_id };

    const invoice = db
      .prepare(
        `SELECT i.id,i.total_paise,i.paid_paise FROM invoices i
         WHERE i.patient_id=? AND i.status IN ('Unpaid','Part Paid')
           AND (i.description LIKE 'Medication dispensing · prescription %'
             OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.appointment_id IS NOT NULL))
         ORDER BY i.issued_at DESC,i.rowid DESC LIMIT 1`,
      )
      .get(charge.patientId) as any;
    const lineDescription = `Consultation/service charge · appointment ${charge.appointmentId}`;
    if (invoice) {
      const lineNo = Number(
        (
          db
            .prepare(
              "SELECT COALESCE(MAX(line_no),-1)+1 AS next_line FROM invoice_items WHERE invoice_id=?",
            )
            .get(invoice.id) as any
        ).next_line,
      );
      db.prepare(
        "INSERT INTO invoice_items(id,invoice_id,line_no,description,quantity,unit_amount_paise,amount_paise,appointment_id) VALUES(?,?,?, ?,1,?,?,?)",
      ).run(
        `line-consult-${charge.appointmentId}`,
        invoice.id,
        lineNo,
        lineDescription,
        charge.feePaise,
        charge.feePaise,
        charge.appointmentId,
      );
      const totalPaise = Number(invoice.total_paise) + charge.feePaise;
      paiseToRupees(totalPaise);
      const paid = Number(invoice.paid_paise);
      const status = paid === 0 ? "Unpaid" : paid >= totalPaise ? "Paid" : "Part Paid";
      db.prepare(
        "UPDATE invoices SET total_paise=?,status=?,updated_at=? WHERE id=?",
      ).run(totalPaise, status, charge.createdAt, invoice.id);
      return { invoiceId: invoice.id };
    }

    const invoiceId = `inv-consult-${charge.appointmentId}`;
    db.prepare(
      "INSERT INTO invoices(id,patient_id,issued_at,due_at,description,total_paise,paid_paise,status,created_at,updated_at) VALUES(?,?,?,?,?,?,0,'Unpaid',?,?)",
    ).run(
      invoiceId,
      charge.patientId,
      charge.issuedAt,
      charge.dueAt,
      `Consultation/service charge · appointment ${charge.appointmentId}`,
      charge.feePaise,
      charge.createdAt,
      charge.createdAt,
    );
    db.prepare(
      "INSERT INTO invoice_items(id,invoice_id,line_no,description,quantity,unit_amount_paise,amount_paise,appointment_id) VALUES(?,?,0,?,1,?,?,?)",
    ).run(
      `line-consult-${charge.appointmentId}`,
      invoiceId,
      lineDescription,
      charge.feePaise,
      charge.feePaise,
      charge.appointmentId,
    );
    return { invoiceId };
  },
};
