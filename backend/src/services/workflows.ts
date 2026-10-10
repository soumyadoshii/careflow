import { randomUUID } from "node:crypto";
import {
  formatINRPaise,
  paiseToRupees,
  rupeesToPaise,
} from "../domain/money.js";
import type { RecordRepository } from "../repositories/recordRepository.js";
import type { Identity } from "../http.js";

export interface WorkflowDependencies {
  records: RecordRepository;
  transaction<T>(operation: () => T): T;
  requireRecord(collection: string, id: string): any;
  availability(
    patientId: string,
    doctorId: string,
    date: string,
    time: string,
    excludeId?: string,
  ): any;
  audit(
    actor: Identity | null,
    action: string,
    area: string,
    id: string,
    details: string,
  ): void;
  notifyAppointmentParties(
    appointment: any,
    title: string,
    message: string,
  ): void;
  timestamp(): string;
  ApiError: new (status: number, code: string, message: string) => Error;
}

/** Core workflows stay independent of Express request/response objects. */
export function createWorkflowServices(d: WorkflowDependencies) {
  const approveAppointment = (id: string, actor: Identity) =>
    d.transaction(() => {
      const row = d.requireRecord("appointments", id);
      if (
        (row.status !== "Pending Approval" &&
          row.status !== "Reschedule Requested") ||
        row.proposalById
      )
        throw new d.ApiError(
          409,
          "INVALID_STATE",
          "Appointment is not awaiting Receptionist approval.",
        );
      const date = row.requestedDate,
        time = row.requestedTime;
      const check = d.availability(row.patientId, row.doctorId, date, time, id);
      if (!check.canSchedule)
        throw new d.ApiError(409, "APPOINTMENT_CONFLICT", check.message);
      row.date = date;
      row.time = time;
      row.confirmedDate = date;
      row.confirmedTime = time;
      row.status = "Scheduled";
      row.approvedById = actor.userId;
      row.approvedByName = actor.name;
      row.updatedAt = d.timestamp();
      delete row.cancellationRequestedAt;
      d.records.put("appointments", row);
      d.audit(
        actor,
        "Appointment approved and scheduled",
        "Appointments",
        id,
        `${actor.name} confirmed ${date} ${time}; patient and Doctor availability rechecked transactionally.`,
      );
      d.notifyAppointmentParties(
        row,
        "Appointment approved and confirmed",
        `${row.provider} · ${date} ${time} is confirmed.`,
      );
      return row;
    });
  const dispensePrescription = (id: string, actor: Identity) =>
    d.transaction(() => {
      const p = d.requireRecord("prescriptions", id);
      if (!["Pending", "Ready for Pickup"].includes(p.status))
        throw new d.ApiError(
          409,
          "INVALID_STATE",
          "Prescription is not eligible for dispensing.",
        );
      const requested = new Map<string, number>();
      for (const line of p.items ?? []) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
          throw new d.ApiError(
            422,
            "VALIDATION_ERROR",
            "Prescription quantities must be positive whole numbers.",
          );
        requested.set(
          line.medicineId,
          (requested.get(line.medicineId) ?? 0) + line.quantity,
        );
      }
      for (const [medicineId, quantity] of requested) {
        const m = d.requireRecord("medicines", medicineId);
        if (!m.active)
          throw new d.ApiError(
            409,
            "INVALID_STATE",
            `Medicine ${m.name} is archived and cannot be dispensed.`,
          );
        if (m.stock < quantity)
          throw new d.ApiError(
            409,
            "INSUFFICIENT_STOCK",
            `Insufficient stock for ${m.name}.`,
          );
      }
      const invoiceId = `inv-disp-${p.id}`;
      if (d.records.get("invoices", invoiceId))
        throw new d.ApiError(
          409,
          "BILLING_ALREADY_EXISTS",
          "A medication invoice already exists for this prescription.",
        );
      const createdAt = d.timestamp();
      const issuedAt = createdAt.slice(0, 10);
      const dueDate = new Date(`${issuedAt}T00:00:00.000Z`);
      dueDate.setUTCDate(dueDate.getUTCDate() + 14);
      d.records.addDispensingInvoice({
        id: invoiceId,
        patientId: p.patientId,
        prescriptionId: p.id,
        issuedAt,
        dueAt: dueDate.toISOString().slice(0, 10),
        createdAt,
        items: (p.items ?? []).map((line: any) => ({
          medicineId: line.medicineId,
          quantity: line.quantity,
        })),
      });
      for (const [medicineId, quantity] of requested) {
        const m = d.requireRecord("medicines", medicineId);
        m.stock -= quantity;
        d.records.put("medicines", m);
      }
      p.status = "Dispensed";
      p.dispensedAt = d.timestamp();
      p.dispensedById = actor.userId;
      d.records.put("prescriptions", p);
      d.audit(
        actor,
        "Prescription dispensed",
        "Pharmacy",
        id,
        "Prescription dispensed; all item stock deducted atomically.",
      );
      return p;
    });
  const receiveProcurement = (id: string, actor: Identity) =>
    d.transaction(() => {
      const order = d.requireRecord("procurement", id);
      if (!["Submitted", "Approved"].includes(order.status))
        throw new d.ApiError(
          409,
          "INVALID_STATE",
          "Only submitted or approved orders can be received, and duplicate receiving is not allowed.",
        );
      for (const line of order.items ?? []) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
          throw new d.ApiError(
            422,
            "VALIDATION_ERROR",
            "Procurement quantities must be positive whole numbers.",
          );
        const medicine = d.requireRecord("medicines", line.medicineId);
        if (!medicine.active)
          throw new d.ApiError(
            409,
            "INVALID_STATE",
            `Medicine ${medicine.name} is archived and cannot be received.`,
          );
      }
      for (const line of order.items) {
        const m = d.requireRecord("medicines", line.medicineId);
        m.stock += line.quantity;
        d.records.put("medicines", m);
      }
      order.status = "Received";
      order.receivedAt = d.timestamp();
      order.receivedById = actor.userId;
      d.records.put("procurement", order);
      d.audit(
        actor,
        "Procurement received",
        "Procurement",
        id,
        "Order received; all medicine stock updates applied atomically.",
      );
      return order;
    });
  const recordInvoicePayment = (
    id: string,
    amount: number,
    actor: Identity,
    method?: string,
  ) =>
    d.transaction(() => {
      const invoice = d.requireRecord("invoices", id);
      if (invoice.status === "Void")
        throw new d.ApiError(
          409,
          "INVALID_STATE",
          "Voided invoices cannot accept payments.",
        );
      let amountPaise: number;
      try {
        amountPaise = rupeesToPaise(amount);
      } catch {
        throw new d.ApiError(
          422,
          "VALIDATION_ERROR",
          "Payment must be a non-negative INR amount with no more than two decimal places.",
        );
      }
      if (amountPaise <= 0)
        throw new d.ApiError(
          422,
          "VALIDATION_ERROR",
          "Payment amount must be greater than zero.",
        );
      const totalPaise = rupeesToPaise(invoice.total);
      const paidPaise = rupeesToPaise(invoice.paid);
      const outstandingPaise = totalPaise - paidPaise;
      if (amountPaise > outstandingPaise)
        throw new d.ApiError(
          422,
          "OVERPAYMENT",
          "Payment cannot exceed the outstanding invoice balance.",
        );
      const nextPaidPaise = paidPaise + amountPaise;
      invoice.paid = paiseToRupees(nextPaidPaise);
      invoice.status =
        nextPaidPaise === totalPaise
          ? "Paid"
          : nextPaidPaise > 0
            ? "Part Paid"
            : "Unpaid";
      invoice.lastPaymentAt = d.timestamp();
      d.records.put("invoices", invoice);
      if (amountPaise > 0)
        d.records.addInvoicePayment({
          id: `pay-${randomUUID()}`,
          invoiceId: id,
          amountPaise,
          method,
          recordedByUserId: actor.userId,
          recordedAt: invoice.lastPaymentAt,
        });
      d.audit(
        actor,
        "Invoice payment recorded",
        "Billing",
        id,
        `Payment ${formatINRPaise(amountPaise)} recorded${method ? ` by ${method}` : ""}.`,
      );
      return invoice;
    });
  return {
    approveAppointment,
    dispensePrescription,
    receiveProcurement,
    recordInvoicePayment,
  };
}
