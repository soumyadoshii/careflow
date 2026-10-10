import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.JWT_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.LOGIN_MAX_ATTEMPTS = "5";
const { resetAndSeed } = await import("../src/db/seed.js");
resetAndSeed();
const { app } = await import("../src/app.js");
let server: any;
let base = "";
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function login(username: string, password = "demo123") {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { response: r, body: (await r.json()) as any };
}
async function call(path: string, token?: string, method = "GET", body?: any) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = r.status === 204 ? null : await r.json();
  return { response: r, body: payload };
}
function successToken(loginResult: any) {
  assert.equal(
    loginResult.response.status,
    200,
    JSON.stringify(loginResult.body),
  );
  return loginResult.body.data.token as string;
}
function dayFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("health, successful bcrypt login, /me, and protected route behavior", async () => {
  const unauth = await call("/patients");
  assert.equal(unauth.response.status, 401);
  const l = await login("admin01");
  const token = successToken(l);
  assert.equal(l.body.data.user.role, "Clinic Administrator");
  assert.equal(typeof l.body.data.token, "string");
  assert.equal(JSON.stringify(l.body).includes("password_hash"), false);
  const doctorTwo = await login("doctor02");
  assert.equal(doctorTwo.response.status, 200);
  assert.equal(doctorTwo.body.data.user.role, "Doctor");
  const malformed = await call("/auth/me", "not.a.valid.jwt");
  assert.equal(malformed.response.status, 401);
  assert.equal("stack" in malformed.body, false);
  const me = await call("/auth/me", token);
  assert.equal(me.response.status, 200);
  assert.equal(me.body.data.userId, "usr-admin");
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.data.phase, "3");
});

test("doctor03 and patient2–patient5 authenticate with the intended role and patient ownership", async () => {
  const doctorLogin = await login("doctor03");
  const doctor = successToken(doctorLogin);
  assert.equal(doctorLogin.body.data.user.role, "Doctor");
  assert.equal((await call("/dashboard/snapshot", doctor)).response.status, 200);
  assert.equal((await call("/consultations", doctor)).response.status, 200);
  assert.equal((await call("/prescriptions", doctor)).response.status, 200);
  const medicines = await call("/medicines", doctor);
  assert.equal(medicines.response.status, 200);
  assert.ok(medicines.body.data.length > 0);
  assert.equal(
    (await call("/medicines", doctor, "POST", { name: "Forbidden" })).response
      .status,
    403,
  );
  assert.equal((await call("/users", doctor)).response.status, 403);
  assert.equal((await call("/suppliers", doctor)).response.status, 403);
  assert.equal(
    (
      await call("/labOrders/lab-3101", doctor, "PUT", {
        status: "Collected",
        result: "Unauthorized doctor result",
      })
    ).response.status,
    403,
  );

  const expected = [
    ["patient2", "pat-1043"],
    ["patient3", "pat-1044"],
    ["patient4", "pat-1045"],
    ["patient5", "pat-1046"],
  ];
  for (const [username, patientId] of expected) {
    const patientLogin = await login(username);
    const patient = successToken(patientLogin);
    assert.equal(patientLogin.body.data.user.role, "Patient");
    assert.equal(patientLogin.body.data.user.patientId, patientId);
    assert.equal((await call(`/patients/${patientId}`, patient)).response.status, 200);
    assert.equal((await call("/users", patient)).response.status, 403);
  }
});

test("Patients can read their own persisted prescriptions only", async () => {
  const patient1 = successToken(await login("patient1"));
  const patient2 = successToken(await login("patient2"));
  const firstList = await call("/prescriptions", patient1);
  assert.equal(firstList.response.status, 200);
  assert.ok(firstList.body.data.some((item: any) => item.id === "rx-5501"));
  assert.ok(firstList.body.data.every((item: any) => item.patientId === "pat-1042"));
  assert.equal(firstList.body.data[0].items[0].medicineName, "Amoxicillin");
  assert.equal((await call("/prescriptions/rx-5501", patient1)).response.status, 200);
  assert.equal((await call("/prescriptions/rx-5502", patient1)).response.status, 403);
  assert.ok(
    (await call("/prescriptions", patient2)).body.data.some(
      (item: any) => item.id === "rx-5502",
    ),
  );
  assert.ok(
    (await call("/prescriptions", patient2)).body.data.every(
      (item: any) => item.patientId === "pat-1043",
    ),
  );
  assert.equal((await call("/medicines", patient1)).response.status, 403);
});

test("invalid login is generic and repeated failures lock an account", async () => {
  const wrong = await login("doctor03", "wrong");
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
  for (let i = 1; i < 5; i++) await login("doctor03", "wrong");
  const locked = await login("doctor03", "demo123");
  assert.equal(locked.response.status, 401);
  assert.equal(locked.body.error.message, wrong.body.error.message);
  const unknown = await login("not-a-user", "anything");
  assert.equal(unknown.body.error.message, wrong.body.error.message);
});

test("server-side role checks, ownership restrictions, and safe user directory", async () => {
  const patient = successToken(await login("patient1"));
  const blocked = await call("/users", patient);
  assert.equal(blocked.response.status, 403);
  const other = await call("/patients/pat-1043", patient);
  assert.equal(other.response.status, 403);
  const own = await call("/patients/pat-1042", patient);
  assert.equal(own.response.status, 200);
  const docs = await call("/users/doctors", patient);
  assert.equal(docs.response.status, 200);
  assert.ok(docs.body.data.length >= 2);
  assert.ok(
    docs.body.data.every((x: any) => x.role === "Doctor" && !("email" in x)),
  );
  assert.ok(docs.body.data.some((x: any) => x.id === "usr-doctor-mei"));
  const receptionist = successToken(await login("receptionist1"));
  const clinical = await call("/consultations", receptionist);
  assert.equal(clinical.response.status, 403);
  const noFinanceRole = await call("/reports/financial", receptionist);
  assert.equal(noFinanceRole.response.status, 403);
  const review = await call("/appointments/apt-2401/review", receptionist);
  assert.equal(review.response.status, 200);
});

test("Patient cannot spoof patientId; appointment request remains pending and notifies receptionist", async () => {
  const patient = successToken(await login("patient1"));
  const requested = await call("/appointments", patient, "POST", {
    patientId: "pat-1043",
    doctorId: "usr-doctor-elise",
    department: "Cardiology",
    requestedDate: dayFromNow(20),
    requestedTime: "10:00",
    type: "Follow-up",
    reason: "Patient-owned request",
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.data.patientId, "pat-1042");
  assert.equal(requested.body.data.status, "Pending Approval");
  assert.equal(requested.body.data.requestedByRole, "Patient");
  const reception = successToken(await login("receptionist1"));
  const notifications = await call("/notifications", reception);
  assert.ok(
    notifications.body.data.some(
      (n: any) =>
        n.title === "Patient appointment request" &&
        n.message.includes(requested.body.data.id),
    ) === false,
  ); // Payload summarizes the requested slot, not the generated identifier.
  assert.ok(
    notifications.body.data.some(
      (n: any) => n.title === "Patient appointment request",
    ),
  );
  const detail = await call(`/appointments/${requested.body.data.id}`, patient);
  assert.equal(detail.response.status, 200);
});

test("Receptionist-created patient is selectable and appointment retains approval workflow", async () => {
  const receptionist = successToken(await login("receptionist1"));
  const created = await call("/patients", receptionist, "POST", {
    id: "pat-reception-flow-test",
    name: "Taylor Morgan",
    dateOfBirth: "1991-03-12",
    sex: "Other",
    phone: "+1 555 014 2299",
    email: "taylor.morgan@example.test",
    bloodGroup: "",
    emergencyContact: "Jordan Morgan · +1 555 014 2298",
    status: "Active",
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.status, "Active");

  const appointmentPatients = await call("/patients", receptionist);
  assert.equal(appointmentPatients.response.status, 200);
  assert.ok(
    appointmentPatients.body.data.some(
      (patient: any) =>
        patient.id === created.body.data.id && patient.status === "Active",
    ),
  );
  const request = await call("/appointments", receptionist, "POST", {
    patientId: created.body.data.id,
    doctorId: "usr-doctor",
    department: "General Medicine",
    requestedDate: dayFromNow(60),
    requestedTime: "10:30",
    type: "New patient",
    reason: "Receptionist scheduled registration follow-up",
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  assert.equal(request.body.data.patientId, created.body.data.id);
  assert.equal(request.body.data.requestedByRole, "Receptionist");
  assert.equal(request.body.data.status, "Pending Approval");
  const notifications = await call("/notifications", receptionist);
  assert.ok(
    notifications.body.data.some(
      (notification: any) =>
        notification.title === "Receptionist appointment request" &&
        notification.message.includes("Taylor Morgan"),
    ),
  );

  const approved = await call(
    `/appointments/${request.body.data.id}/approve`,
    receptionist,
    "POST",
    {},
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "Scheduled");
  const doctor = successToken(await login("doctor01"));
  const doctorAppointments = await call("/appointments", doctor);
  assert.ok(
    doctorAppointments.body.data.some(
      (appointment: any) => appointment.id === request.body.data.id,
    ),
  );
});

test("two simultaneous approvals cannot double-book a doctor/time slot", async () => {
  const doctor = successToken(await login("doctor01")),
    reception = successToken(await login("receptionist1"));
  const date = dayFromNow(23);
  const create = (patientId: string) =>
    call("/appointments", doctor, "POST", {
      patientId,
      requestedDate: date,
      requestedTime: "11:00",
      type: "Review",
      reason: "Concurrency check",
    });
  const [one, two] = await Promise.all([
    create("pat-1042"),
    create("pat-1044"),
  ]);
  assert.equal(one.response.status, 201);
  assert.equal(two.response.status, 201);
  const results = await Promise.all([
    call(`/appointments/${one.body.data.id}/approve`, reception, "POST", {}),
    call(`/appointments/${two.body.data.id}/approve`, reception, "POST", {}),
  ]);
  assert.equal(
    results.filter((x) => x.response.status === 200).length,
    1,
    JSON.stringify(results.map((x) => x.body)),
  );
  assert.equal(
    results.filter(
      (x) =>
        x.response.status === 409 &&
        x.body.error.code === "APPOINTMENT_CONFLICT",
    ).length,
    1,
  );
});

test("patient/doctor availability blocks stop approval; receptionist reschedule proposals remain unconfirmed until accepted", async () => {
  const reception = successToken(await login("receptionist1")),
    patient = successToken(await login("patient1"));
  const date = dayFromNow(24);
  const block = await call("/availabilityBlocks", reception, "POST", {
    targetType: "Patient",
    targetId: "pat-1042",
    date,
    startTime: "09:00",
    endTime: "09:30",
    reason: "Unavailable",
  });
  assert.equal(block.response.status, 201);
  const doctor = successToken(await login("doctor01"));
  const doctorBlock = await call("/availabilityBlocks", reception, "POST", {
    targetType: "Doctor",
    targetId: "usr-doctor",
    date,
    startTime: "11:00",
    endTime: "11:30",
    reason: "Doctor unavailable",
  });
  assert.equal(doctorBlock.response.status, 201);
  const doctorBlockedRequest = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor",
    requestedDate: date,
    requestedTime: "11:00",
    type: "Review",
    reason: "Doctor-blocked slot",
  });
  const doctorBlockedApproval = await call(
    `/appointments/${doctorBlockedRequest.body.data.id}/approve`,
    reception,
    "POST",
    {},
  );
  assert.equal(doctorBlockedApproval.response.status, 409);
  const request = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor",
    requestedDate: date,
    requestedTime: "09:00",
    type: "Review",
    reason: "Blocked slot",
  });
  assert.equal(request.response.status, 201);
  const approval = await call(
    `/appointments/${request.body.data.id}/approve`,
    reception,
    "POST",
    {},
  );
  assert.equal(approval.response.status, 409);
  const good = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor",
    requestedDate: date,
    requestedTime: "10:00",
    type: "Review",
    reason: "Propose another time",
  });
  assert.equal(good.response.status, 201);
  const proposed = await call(
    `/appointments/${good.body.data.id}/propose-time`,
    reception,
    "POST",
    { date, time: "10:30" },
  );
  assert.equal(proposed.response.status, 200);
  assert.equal(proposed.body.data.status, "Reschedule Requested");
  assert.equal(proposed.body.data.confirmedDate, undefined);
  const accepted = await call(
    `/appointments/${good.body.data.id}/accept-proposed-time`,
    patient,
    "POST",
    {},
  );
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.data.requestedTime, "10:30");
  assert.equal(accepted.body.data.status, "Reschedule Requested");
  const scheduled = await call(
    `/appointments/${good.body.data.id}/approve`,
    reception,
    "POST",
    {},
  );
  assert.equal(scheduled.response.status, 200);
  assert.equal(scheduled.body.data.status, "Scheduled");
  assert.equal(scheduled.body.data.confirmedTime, "10:30");
  void doctor;
});

test("invalid appointment transitions are rejected; cancellation and notifications are audited", async () => {
  const receptionist = successToken(await login("receptionist1")),
    patient = successToken(await login("patient1"));
  const appt = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor-elise",
    requestedDate: dayFromNow(27),
    requestedTime: "14:00",
    type: "Consultation",
    reason: "Cancellation flow",
  });
  const id = appt.body.data.id;
  const invalid = await call(
    `/appointments/${id}/status`,
    receptionist,
    "PATCH",
    { status: "Completed" },
  );
  assert.equal(invalid.response.status, 409);
  const req = await call(
    `/appointments/${id}/cancellation-request`,
    patient,
    "POST",
    { reason: "Schedule conflict" },
  );
  assert.equal(req.response.status, 200);
  assert.ok(req.body.data.cancellationRequestedAt);
  const cancel = await call(
    `/appointments/${id}/cancel`,
    receptionist,
    "POST",
    { reason: "Approved cancellation" },
  );
  assert.equal(cancel.response.status, 200);
  assert.equal(cancel.body.data.status, "Cancelled");
  const n = await call("/notifications", patient);
  assert.ok(n.body.data.some((x: any) => x.title === "Appointment cancelled"));
  const admin = successToken(await login("admin01"));
  const audits = await call("/audit", admin);
  assert.ok(
    audits.body.data.some(
      (x: any) => x.recordId === id && x.action === "Appointment cancelled",
    ),
  );
});

test("Clinic Administrator can use existing valid appointment actions", async () => {
  const receptionist = successToken(await login("receptionist1"));
  const admin = successToken(await login("admin01"));
  const patient = successToken(await login("patient1"));
  const request = async (day: number, time: string, doctorId = "usr-doctor") => {
    const created = await call("/appointments", patient, "POST", {
      doctorId,
      requestedDate: dayFromNow(day),
      requestedTime: time,
      type: "Review",
      reason: "Administrator action regression test",
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const approved = await call(
      `/appointments/${created.body.data.id}/approve`,
      receptionist,
      "POST",
      {},
    );
    assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, "Scheduled");
    return created.body.data.id as string;
  };

  const checkInId = await request(12, "12:00");
  assert.equal(
    (
      await call(`/appointments/${checkInId}/status`, admin, "PATCH", {
        status: "Checked In",
      })
    ).response.status,
    200,
  );
  assert.equal(
    (
      await call(`/appointments/${checkInId}/status`, admin, "PATCH", {
        status: "Completed",
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await call(`/appointments/${checkInId}/status`, admin, "PATCH", {
        status: "In Consultation",
      })
    ).response.status,
    200,
  );
  assert.equal(
    (
      await call(`/appointments/${checkInId}/status`, admin, "PATCH", {
        status: "Completed",
      })
    ).response.status,
    200,
  );

  const noShowId = await request(13, "08:00", "usr-doctor-elise");
  const { records } = await import("../src/repositories/recordRepository.js");
  const noShow = records.get("appointments", noShowId);
  const past = dayFromNow(-1);
  noShow.date = past;
  noShow.confirmedDate = past;
  records.put("appointments", noShow);
  const markedNoShow = await call(
    `/appointments/${noShowId}/status`,
    admin,
    "PATCH",
    { status: "No Show" },
  );
  assert.equal(markedNoShow.response.status, 200, JSON.stringify(markedNoShow.body));
  assert.equal(markedNoShow.body.data.status, "No Show");

  const cancelId = await request(14, "13:00", "usr-doctor-mei");
  const cancelled = await call(
    `/appointments/${cancelId}/cancel`,
    admin,
    "POST",
    { reason: "Administrator cancellation test" },
  );
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "Cancelled");
});

test("appointment completion adds the configurable paise fee to the same invoice as pharmacy charges", async () => {
  const doctor = successToken(await login("doctor01"));
  const pharmacist = successToken(await login("pharmacist1"));
  const receptionist = successToken(await login("receptionist1"));
  const admin = successToken(await login("admin01"));
  const patient = successToken(await login("patient1"));
  const otherPatient = successToken(await login("patient2"));
  const { rupeesToPaise } = await import("../src/domain/money.js");

  const setting = await call("/settings", admin);
  assert.equal(setting.response.status, 200);
  assert.equal(
    setting.body.data.find((row: any) => row.id === "consultation-fee")?.value,
    "50000",
  );
  const updatedSetting = await call(
    "/settings/consultation-fee",
    admin,
    "PUT",
    { value: "50500" },
  );
  assert.equal(updatedSetting.response.status, 200);

  try {
    const prescription = await call("/prescriptions", doctor, "POST", {
      patientId: "pat-1042",
      date: dayFromNow(1),
      items: [
        {
          medicineId: "med-103",
          dose: "once daily",
          quantity: 2,
          instructions: "Take with water",
        },
      ],
    });
    assert.equal(prescription.response.status, 201, JSON.stringify(prescription.body));
    const createdPrescriptionId = prescription.body.data.id;
    const pharmacistList = await call("/prescriptions", pharmacist);
    assert.ok(
      pharmacistList.body.data.some(
        (item: any) => item.id === createdPrescriptionId,
      ),
    );
    const patientList = await call("/prescriptions", patient);
    assert.ok(
      patientList.body.data.some(
        (item: any) =>
          item.id === createdPrescriptionId && item.patientId === "pat-1042",
      ),
    );
    const otherPatientList = await call("/prescriptions", otherPatient);
    assert.ok(
      otherPatientList.body.data.every(
        (item: any) => item.patientId === "pat-1043",
      ),
    );
    assert.ok(
      !otherPatientList.body.data.some(
        (item: any) => item.id === createdPrescriptionId,
      ),
    );
    const dispensed = await call(
      `/prescriptions/${prescription.body.data.id}/dispense`,
      pharmacist,
      "POST",
      {},
    );
    assert.equal(dispensed.response.status, 200, JSON.stringify(dispensed.body));
    const { db } = await import("../src/db/database.js");
    const medicationLine = db
      .prepare("SELECT invoice_id FROM invoice_items WHERE id=?")
      .get(`inv-disp-${prescription.body.data.id}-line-1`) as any;
    assert.ok(medicationLine?.invoice_id);
    const medicationInvoiceId = String(medicationLine.invoice_id);
    const medicationInvoice = await call(
      `/invoices/${medicationInvoiceId}`,
      patient,
    );
    assert.equal(medicationInvoice.response.status, 200);
    const medicationTotalPaise = rupeesToPaise(
      medicationInvoice.body.data.total,
    );

    const appointments = await call("/appointments", receptionist);
    const future = appointments.body.data.find(
      (row: any) => row.id === "apt-2411",
    );
    const elapsed = appointments.body.data.find(
      (row: any) => row.id === "apt-2404",
    );
    assert.equal(future?.noShowEligible, false);
    assert.equal(elapsed?.noShowEligible, true);

    assert.equal(
      (await call("/appointments/apt-2411/status", receptionist, "PATCH", {
        status: "Checked In",
      })).response.status,
      200,
    );
    assert.equal(
      (await call("/appointments/apt-2411/status", receptionist, "PATCH", {
        status: "In Consultation",
      })).response.status,
      200,
    );
    const completed = await call(
      "/appointments/apt-2411/status",
      admin,
      "PATCH",
      { status: "Completed" },
    );
    assert.equal(completed.response.status, 200, JSON.stringify(completed.body));

    const invoice = await call(`/invoices/${medicationInvoiceId}`, patient);
    assert.equal(invoice.response.status, 200);
    assert.equal(invoice.body.data.patientId, "pat-1042");
    assert.equal(invoice.body.data.status, "Unpaid");
    assert.ok(
      invoice.body.data.items.some(
        (item: any) => item.appointmentId === "apt-2411",
      ),
    );
    assert.ok(
      invoice.body.data.items.some(
        (item: any) => !item.appointmentId && item.quantity === 2,
      ),
    );
    assert.equal(
      rupeesToPaise(invoice.body.data.total),
      medicationTotalPaise + 50500,
    );
    const forbidden = await call(`/invoices/${medicationInvoiceId}`, otherPatient);
    assert.equal(forbidden.response.status, 403);

    assert.equal(
      Number(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM invoice_items WHERE appointment_id='apt-2411'",
            )
            .get() as any
        ).n,
      ),
      1,
    );
    assert.equal(
      (
        await call("/appointments/apt-2411/status", receptionist, "PATCH", {
          status: "Completed",
        })
      ).response.status,
      409,
    );
    assert.equal(
      Number(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM invoice_items WHERE appointment_id='apt-2411'",
            )
            .get() as any
        ).n,
      ),
      1,
    );
  } finally {
    const resetSetting = await call(
      "/settings/consultation-fee",
      admin,
      "PUT",
      { value: "50000" },
    );
    assert.equal(resetSetting.response.status, 200);
  }
});

test("consultation invoice failure rolls back appointment completion and can be retried once fixed", async () => {
  const receptionist = successToken(await login("receptionist1"));
  const admin = successToken(await login("admin01"));
  const { db } = await import("../src/db/database.js");
  for (const status of ["Checked In", "In Consultation"] as const) {
    const moved = await call(
      "/appointments/apt-2406/status",
      receptionist,
      "PATCH",
      { status },
    );
    assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  }
  db.exec(
    "CREATE TRIGGER force_consultation_invoice_failure BEFORE INSERT ON invoice_items WHEN NEW.appointment_id='apt-2406' BEGIN SELECT RAISE(ABORT, 'forced consultation billing failure'); END;",
  );
  try {
    const failed = await call(
      "/appointments/apt-2406/status",
      admin,
      "PATCH",
      { status: "Completed" },
    );
    assert.equal(failed.response.status, 500);
    assert.equal(
      (await call("/appointments/apt-2406", receptionist)).body.data.status,
      "In Consultation",
    );
    assert.equal(
      Number(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM invoice_items WHERE appointment_id='apt-2406'",
            )
            .get() as any
        ).n,
      ),
      0,
    );
  } finally {
    db.exec("DROP TRIGGER IF EXISTS force_consultation_invoice_failure");
  }
  const completed = await call(
    "/appointments/apt-2406/status",
    admin,
    "PATCH",
    { status: "Completed" },
  );
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  const { records } = await import("../src/repositories/recordRepository.js");
  assert.equal(
    records
      .list("invoices")
      .flatMap((invoice: any) => invoice.items)
      .filter((item: any) => item.appointmentId === "apt-2406").length,
    1,
  );
});

test("dispensing rejects shortages atomically and successful dispensing decrements stock once", async () => {
  const doctor = successToken(await login("doctor01")),
    pharmacist = successToken(await login("pharmacist1"));
  const rx = await call("/prescriptions", doctor, "POST", {
    patientId: "pat-1042",
    date: dayFromNow(1),
    items: [
      {
        medicineId: "med-107",
        dose: "as directed",
        quantity: 1,
        instructions: "Test",
      },
    ],
  });
  assert.equal(rx.response.status, 201, JSON.stringify(rx.body));
  const short = await call(
    `/prescriptions/${rx.body.data.id}/dispense`,
    pharmacist,
    "POST",
    {},
  );
  assert.equal(short.response.status, 409);
  assert.equal(short.body.error.code, "INSUFFICIENT_STOCK");
  const still = await call(`/prescriptions/${rx.body.data.id}`, pharmacist);
  assert.equal(still.body.data.status, "Pending");
  const med0 = await call("/medicines/med-107", pharmacist);
  assert.equal(med0.body.data.stock, 0);
  const before = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  const success = await call(
    "/prescriptions/rx-5502/dispense",
    pharmacist,
    "POST",
    {},
  );
  assert.equal(success.response.status, 200);
  assert.equal(success.body.data.status, "Dispensed");
  const afterStock = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  assert.equal(afterStock, before - 30);
  const duplicate = await call(
    "/prescriptions/rx-5502/dispense",
    pharmacist,
    "POST",
    {},
  );
  assert.equal(duplicate.response.status, 409);
});

test("dispensing creates one patient-owned invoice and billing failure rolls back stock", async () => {
  const pharmacist = successToken(await login("pharmacist1"));
  const patient2 = successToken(await login("patient2"));
  const patient1 = successToken(await login("patient1"));
  const medicationInvoice = await call("/invoices/inv-disp-rx-5502", patient2);
  assert.equal(medicationInvoice.response.status, 200);
  assert.equal(medicationInvoice.body.data.patientId, "pat-1043");
  assert.equal(medicationInvoice.body.data.items.length, 1);
  assert.equal(medicationInvoice.body.data.items[0].quantity, 30);
  assert.equal(
    (await call("/invoices/inv-disp-rx-5502", patient1)).response.status,
    403,
  );
  const { db } = await import("../src/db/database.js");
  assert.equal(
    Number(
      (db.prepare("SELECT count(*) n FROM invoices WHERE id=?").get("inv-disp-rx-5502") as any).n,
    ),
    1,
  );

  const doctor = successToken(await login("doctor01"));
  const rollbackRx = await call("/prescriptions", doctor, "POST", {
    patientId: "pat-1042",
    date: dayFromNow(1),
    items: [
      {
        medicineId: "med-103",
        dose: "as directed",
        quantity: 1,
        instructions: "Rollback billing test",
      },
    ],
  });
  assert.equal(rollbackRx.response.status, 201, JSON.stringify(rollbackRx.body));
  const rollbackInvoiceId = `inv-disp-${rollbackRx.body.data.id}`;
  const stockBeforeFailedInvoice = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  db.exec(
    `CREATE TRIGGER force_dispensing_invoice_failure BEFORE INSERT ON invoice_items WHEN NEW.id LIKE '${rollbackInvoiceId.replaceAll("'", "''")}%'
      BEGIN SELECT RAISE(ABORT, 'forced billing failure'); END;`,
  );
  try {
    const failed = await call(
      `/prescriptions/${rollbackRx.body.data.id}/dispense`,
      pharmacist,
      "POST",
      {},
    );
    assert.equal(failed.response.status, 500);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS force_dispensing_invoice_failure");
  }
  assert.equal(
    Number((await call("/medicines/med-103", pharmacist)).body.data.stock),
    stockBeforeFailedInvoice,
  );
  assert.equal(
    (await call(`/prescriptions/${rollbackRx.body.data.id}`, pharmacist)).body
      .data.status,
    "Pending",
  );
  assert.equal(
    Number(
      (db.prepare("SELECT count(*) n FROM invoices WHERE id=?").get(rollbackInvoiceId) as any).n,
    ),
    0,
  );
});

test("procurement receive is atomic, audited, and idempotency protected", async () => {
  const pharmacist = successToken(await login("pharmacist1"));
  const before = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  const received = await call(
    "/procurement/po-801/receive",
    pharmacist,
    "POST",
    {},
  );
  assert.equal(received.response.status, 200);
  assert.equal(received.body.data.status, "Received");
  const after = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  assert.equal(after, before + 100);
  const duplicate = await call(
    "/procurement/po-801/receive",
    pharmacist,
    "POST",
    {},
  );
  assert.equal(duplicate.response.status, 409);
});

test("payments validate outstanding balance and calculate invoice status server-side", async () => {
  const reception = successToken(await login("receptionist1"));
  const paid = await call("/invoices/inv-9202/payments", reception, "POST", {
    amount: 50,
  });
  assert.equal(paid.response.status, 200);
  assert.equal(paid.body.data.paid, 50);
  assert.equal(paid.body.data.status, "Part Paid");
  const over = await call("/invoices/inv-9202/payments", reception, "POST", {
    amount: 200,
  });
  assert.equal(over.response.status, 422);
  assert.equal(over.body.error.code, "OVERPAYMENT");
  const invalid = await call("/invoices/inv-9202/payments", reception, "POST", {
    amount: -1,
  });
  assert.equal(invalid.response.status, 422);
});

test("laboratory workflow enforces transitions and releases only reviewed patient results", async () => {
  const lab = successToken(await login("labtech1")),
    patient = successToken(await login("patient1"));
  const skip = await call("/labOrders/lab-3101", lab, "PUT", {
    status: "Reviewed",
  });
  assert.equal(skip.response.status, 409);
  const completed = await call("/labOrders/lab-3101", lab, "PUT", {
    status: "Completed",
    result: "Within reference",
  });
  assert.equal(completed.response.status, 200);
  const reviewed = await call("/labOrders/lab-3101", lab, "PUT", {
    status: "Reviewed",
  });
  assert.equal(reviewed.response.status, 200);
  const records = await call("/medical-records", patient);
  assert.ok(records.body.data.rows.some((r: any) => r.id === "lab-3101"));
});

test("reports return JSON/CSV and audit is admin-only", async () => {
  const admin = successToken(await login("admin01")),
    reception = successToken(await login("receptionist1"));
  const report = await call(
    "/reports/financial?from=2026-09-01&to=2026-10-31",
    admin,
  );
  assert.equal(report.response.status, 200);
  assert.ok(Array.isArray(report.body.data.rows));
  const csv = await fetch(`${base}/api/reports/operational?format=csv`, {
    headers: { authorization: `Bearer ${reception}` },
  });
  assert.equal(csv.status, 200);
  assert.ok((csv.headers.get("content-type") ?? "").includes("text/csv"));
  const xlsxResponse = await fetch(
    `${base}/api/reports/financial?format=xlsx`,
    { headers: { authorization: `Bearer ${admin}` } },
  );
  assert.equal(xlsxResponse.status, 200);
  const xlsxParts = unzipSync(new Uint8Array(await xlsxResponse.arrayBuffer()));
  assert.ok(xlsxParts["xl/worksheets/sheet1.xml"]);
  assert.ok(
    strFromU8(xlsxParts["xl/worksheets/sheet1.xml"]).includes("Invoice"),
  );
  const pdf = await fetch(`${base}/api/reports/financial?format=pdf`, {
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(pdf.status, 200);
  assert.ok(
    (pdf.headers.get("content-type") ?? "").includes("application/pdf"),
  );
  const print = await fetch(`${base}/api/reports/operational?format=print`, {
    headers: { authorization: `Bearer ${reception}` },
  });
  assert.equal(print.status, 200);
  assert.ok((await print.text()).includes("window.print"));
  const forbidden = await call("/audit", reception);
  assert.equal(forbidden.response.status, 403);
});

test("logout invalidates current JWT and password change requires the current bcrypt credential", async () => {
  const session = await login("patient1");
  const token = successToken(session);
  const wrong = await call("/profile/password", token, "PUT", {
    currentPassword: "bad",
    newPassword: "brand-new-secret",
  });
  assert.equal(wrong.response.status, 401);
  const changed = await call("/profile/password", token, "PUT", {
    currentPassword: "demo123",
    newPassword: "brand-new-secret",
  });
  assert.equal(changed.response.status, 200);
  const old = await call("/auth/me", token);
  assert.equal(old.response.status, 401);
  const relog = await login("patient1", "brand-new-secret");
  assert.equal(relog.response.status, 200);
  const logout = await call("/auth/logout", relog.body.data.token, "POST", {});
  assert.equal(logout.response.status, 200);
  const invalid = await call("/auth/me", relog.body.data.token);
  assert.equal(invalid.response.status, 401);
});

test("consultation CRUD is doctor-owned, and the consultation status machine is sequential", async () => {
  const doctor = successToken(await login("doctor01")),
    reception = successToken(await login("receptionist1"));
  const denied = await call("/consultations", reception, "POST", {
    appointmentId: "apt-2403",
    reason: "x",
    notes: "x",
    date: "2026-10-02",
    status: "Waiting",
  });
  assert.equal(denied.response.status, 403);
  const checkin = await call(
    "/appointments/apt-2403/status",
    reception,
    "PATCH",
    { status: "Checked In" },
  );
  assert.equal(checkin.response.status, 200);
  const created = await call("/consultations", doctor, "POST", {
    appointmentId: "apt-2403",
    reason: "Follow-up exam",
    notes: "Vitals reviewed.",
    date: "2026-10-02",
    status: "Waiting",
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.patientId, "pat-1044");
  const skip = await call(
    `/consultations/${created.body.data.id}`,
    doctor,
    "PUT",
    { status: "Completed" },
  );
  assert.equal(skip.response.status, 409);
  const start = await call(
    `/consultations/${created.body.data.id}`,
    doctor,
    "PUT",
    { status: "In Progress" },
  );
  assert.equal(start.response.status, 200);
  const complete = await call(
    `/consultations/${created.body.data.id}`,
    doctor,
    "PUT",
    { status: "Completed" },
  );
  assert.equal(complete.response.status, 200);
});

test("admin user creation requires supplied credentials but never echoes a password; stock requires the adjustment endpoint", async () => {
  const admin = successToken(await login("admin01")),
    pharmacist = successToken(await login("pharmacist1"));
  const created = await call("/users", admin, "POST", {
    name: "New test clinician",
    email: "new.clinician@example.test",
    role: "Doctor",
    department: "General Medicine",
    password: "SecureClinicianPass9",
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.data.loginUsername);
  assert.equal("password" in created.body.data, false);
  assert.equal(JSON.stringify(created.body).includes("password_hash"), false);
  const newLogin = await login(
    created.body.data.loginUsername,
    "SecureClinicianPass9",
  );
  assert.equal(newLogin.response.status, 200);
  const blocked = await call("/medicines/med-101", pharmacist, "PUT", {
    stock: 99999,
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error.code, "STOCK_ENDPOINT_REQUIRED");
  const privatePatient = await call("/patients/pat-1042", pharmacist);
  assert.deepEqual(Object.keys(privatePatient.body.data).sort(), [
    "id",
    "mrn",
    "name",
    "status",
  ]);
  const medicalTimeline = await call("/medical-records", pharmacist);
  assert.equal(medicalTimeline.response.status, 403);
});

test("laboratory technicians can access only assigned lab workflow records", async () => {
  const lab = successToken(await login("labtech1"));
  const own = await call("/labOrders/lab-3101", lab);
  assert.equal(own.response.status, 200);
  const other = await call("/labOrders/lab-3104", lab);
  assert.equal(other.response.status, 403);
});

test("normalized schema stores clinic records in typed relational tables", async () => {
  const { db } = await import("../src/db/database.js");
  const tables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as any[]
    ).map((x) => x.name),
  );
  for (const name of [
    "patients",
    "users",
    "appointments",
    "consultations",
    "prescriptions",
    "prescription_items",
    "lab_orders",
    "medicines",
    "suppliers",
    "procurement_orders",
    "procurement_items",
    "invoices",
    "invoice_items",
    "invoice_payments",
    "audit",
    "notifications",
    "settings",
    "schema_migrations",
  ])
    assert.ok(tables.has(name), name);
  assert.equal(tables.has("records"), false);
  const invoiceColumns = new Set(
    (db.prepare("PRAGMA table_info(invoices)").all() as any[]).map(
      (x) => x.name,
    ),
  );
  assert.ok(invoiceColumns.has("total_paise"));
  assert.ok(invoiceColumns.has("paid_paise"));
  assert.equal(
    (db.prepare("PRAGMA foreign_key_check").all() as any[]).length,
    0,
  );
});

test("multi-line INR invoice totals and payments use exact integer paise and server-derived status", async () => {
  const admin = successToken(await login("admin01"));
  const created = await call("/invoices", admin, "POST", {
    id: "inv-phase3-175050",
    patientId: "pat-1042",
    issuedAt: "2026-10-03",
    dueAt: "2026-10-20",
    description: "Consultation, medicines and laboratory",
    items: [
      { description: "Consultation Fee", quantity: 1, unitPrice: 500 },
      { description: "Medicines", quantity: 1, unitPrice: 250.5 },
      { description: "Laboratory", quantity: 1, unitPrice: 1000 },
    ],
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.total, 1750.5);
  assert.equal(created.body.data.paid, 0);
  assert.equal(created.body.data.status, "Unpaid");
  assert.deepEqual(
    created.body.data.items.map((x: any) => x.unitPrice),
    [500, 250.5, 1000],
  );
  const { db } = await import("../src/db/database.js");
  const stored = db
    .prepare("SELECT total_paise,paid_paise FROM invoices WHERE id=?")
    .get("inv-phase3-175050") as any;
  assert.equal(stored.total_paise, 175050);
  assert.equal(stored.paid_paise, 0);
  const lines = db
    .prepare(
      "SELECT description,amount_paise FROM invoice_items WHERE invoice_id=? ORDER BY line_no",
    )
    .all("inv-phase3-175050") as any[];
  assert.deepEqual(
    lines.map((x) => x.amount_paise),
    [50000, 25050, 100000],
  );
  const payment = await call(
    "/invoices/inv-phase3-175050/payments",
    admin,
    "POST",
    { amount: 1000, method: "Counter" },
  );
  assert.equal(payment.response.status, 200, JSON.stringify(payment.body));
  assert.equal(payment.body.data.paid, 1000);
  assert.equal(payment.body.data.status, "Part Paid");
  assert.equal(
    (
      db
        .prepare("SELECT paid_paise FROM invoices WHERE id=?")
        .get("inv-phase3-175050") as any
    ).paid_paise,
    100000,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT amount_paise FROM invoice_payments WHERE invoice_id=? AND entry_kind='payment'",
        )
        .get("inv-phase3-175050") as any
    ).amount_paise,
    100000,
  );
  const report = await call(
    "/reports/financial?from=2026-10-03&to=2026-10-03",
    admin,
  );
  const reportRow = report.body.data.rows.find(
    (x: any) => x.Invoice === "inv-phase3-175050",
  );
  assert.equal(reportRow.Total, "₹1,750.50");
  assert.equal(reportRow.Paid, "₹1,000.00");
  assert.equal(reportRow.Balance, "₹750.50");
  const rawExport = async (format: string) =>
    fetch(
      `${base}/api/reports/financial?from=2026-10-03&to=2026-10-03&format=${format}`,
      { headers: { authorization: `Bearer ${admin}` } },
    );
  const printResponse = await rawExport("print");
  assert.equal(printResponse.status, 200);
  const printHtml = await printResponse.text();
  assert.ok(printHtml.includes("₹1,750.50") && printHtml.includes("₹750.50"));
  const csvResponse = await rawExport("csv");
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.ok(
    csv.includes("₹1,750.50") &&
      csv.includes("₹1,000.00") &&
      csv.includes("₹750.50"),
  );
  const xlsxResponse = await rawExport("xlsx");
  assert.equal(xlsxResponse.status, 200);
  const xlsx = unzipSync(new Uint8Array(await xlsxResponse.arrayBuffer()));
  const worksheet = strFromU8(xlsx["xl/worksheets/sheet1.xml"]);
  assert.ok(
    worksheet.includes("₹1,750.50") &&
      worksheet.includes("₹1,000.00") &&
      worksheet.includes("₹750.50"),
  );
  const pdfResponse = await rawExport("pdf");
  assert.equal(pdfResponse.status, 200);
  const pdfPath = join(tmpdir(), `careflow-inr-${process.pid}.pdf`);
  writeFileSync(pdfPath, Buffer.from(await pdfResponse.arrayBuffer()));
  try {
    const extracted = execFileSync("pdftotext", [pdfPath, "-"], {
      encoding: "utf8",
    });
    assert.ok(
      extracted.includes("₹1,750.50") &&
        extracted.includes("₹1,000.00") &&
        extracted.includes("₹750.50"),
      extracted,
    );
  } finally {
    unlinkSync(pdfPath);
  }
  assert.equal(
    (
      await call("/invoices/inv-phase3-175050/payments", admin, "POST", {
        amount: 750.51,
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await call("/invoices/inv-phase3-175050/payments", admin, "POST", {
        amount: -1,
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await call("/invoices/inv-phase3-175050/payments", admin, "POST", {
        amount: 0.001,
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await call("/invoices/inv-phase3-175050", admin, "PUT", {
        paid: 1750.5,
        status: "Paid",
      })
    ).response.status,
    403,
  );
});

test("integrated appointment journey preserves pending approval, receptionist authority, availability, and party notifications", async () => {
  const { resetAndSeed } = await import("../src/db/seed.js");
  resetAndSeed();
  const patient = successToken(await login("patient1"));
  const date = dayFromNow(24);
  const requestResult = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor",
    requestedDate: date,
    requestedTime: "14:00",
    type: "Check-up",
    reason: "Integrated patient journey test",
  });
  assert.equal(
    requestResult.response.status,
    201,
    JSON.stringify(requestResult.body),
  );
  const appointment = requestResult.body.data;
  assert.equal(appointment.status, "Pending Approval");
  assert.equal(appointment.patientId, "pat-1042");
  assert.notEqual(appointment.status, "Scheduled");

  const receptionist = successToken(await login("receptionist1"));
  const review = await call(
    `/appointments/${appointment.id}/review`,
    receptionist,
  );
  assert.equal(review.response.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.data.patient.id, "pat-1042");
  assert.ok(Array.isArray(review.body.data.patientSchedule));
  assert.ok(Array.isArray(review.body.data.doctorSchedule));
  const approval = await call(
    `/appointments/${appointment.id}/approve`,
    receptionist,
    "POST",
    {},
  );
  assert.equal(approval.response.status, 200, JSON.stringify(approval.body));
  assert.equal(approval.body.data.status, "Scheduled");

  const patientSchedule = await call("/appointments", patient);
  assert.ok(
    patientSchedule.body.data.some(
      (x: any) => x.id === appointment.id && x.status === "Scheduled",
    ),
  );
  const patientNotifications = await call("/notifications", patient);
  assert.ok(
    patientNotifications.body.data.some(
      (x: any) =>
        x.patientId === "pat-1042" &&
        /confirm|schedul/i.test(`${x.title} ${x.message}`),
    ),
  );
  const doctor = successToken(await login("doctor01"));
  const doctorSchedule = await call("/appointments", doctor);
  assert.ok(
    doctorSchedule.body.data.some(
      (x: any) => x.id === appointment.id && x.status === "Scheduled",
    ),
  );
  const doctorNotifications = await call("/notifications", doctor);
  assert.ok(
    doctorNotifications.body.data.some((x: any) =>
      /confirm|schedul/i.test(`${x.title} ${x.message}`),
    ),
  );

  const doctorRequest = await call("/appointments", doctor, "POST", {
    patientId: "pat-1042",
    doctorId: "usr-doctor",
    requestedDate: date,
    requestedTime: "14:00",
    type: "Follow-up",
    reason: "Conflict journey test",
  });
  assert.equal(
    doctorRequest.response.status,
    201,
    JSON.stringify(doctorRequest.body),
  );
  assert.equal(doctorRequest.body.data.status, "Pending Approval");
  const conflictReview = await call(
    `/appointments/${doctorRequest.body.data.id}/review`,
    receptionist,
  );
  assert.equal(conflictReview.response.status, 200);
  assert.ok(
    conflictReview.body.data.nearbySlots.some(
      (x: any) =>
        x.time === "14:00" && !x.canSchedule && Boolean(x.doctorConflict),
    ),
  );
  const conflictApproval = await call(
    `/appointments/${doctorRequest.body.data.id}/approve`,
    receptionist,
    "POST",
    {},
  );
  assert.equal(conflictApproval.response.status, 409);
  assert.equal(
    (await call("/appointments", patient)).body.data.some(
      (x: any) => x.id === appointment.id && x.status === "Scheduled",
    ),
    true,
  );
});
