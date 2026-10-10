import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.JWT_SECRET = "phase4-regression-secret-with-at-least-32-characters";
process.env.LOGIN_MAX_ATTEMPTS = "5";
process.env.CLINIC_TIME_ZONE = "Asia/Kolkata";

const { resetAndSeed } = await import("../src/db/seed.js");
resetAndSeed();
const { db } = await import("../src/db/database.js");
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
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data.token as string;
}
async function call(path: string, token?: string, method = "GET", body?: any) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
  };
}

function dayFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("integer-paise helpers enforce exact cents and a documented safe API ceiling", async () => {
  const { rupeesToPaise, paiseToRupees, formatINRPaise } =
    await import("../src/domain/money.js");
  assert.equal(rupeesToPaise("0.01"), 1);
  assert.equal(rupeesToPaise("100000.10"), 10_000_010);
  assert.equal(paiseToRupees(10_000_010), 100_000.1);
  assert.equal(formatINRPaise(17_505_050), "₹1,75,050.50");
  assert.throws(() => rupeesToPaise("1.001"));
  assert.throws(() => rupeesToPaise("-0.01"));
  assert.throws(() => rupeesToPaise("70000000000000.01"));
  assert.throws(() => paiseToRupees(Number.MAX_SAFE_INTEGER));
  assert.throws(() => formatINRPaise(0.5));
});

test("versioned relational migrations and SQLite triggers enforce Patient linkage", () => {
  const migrations = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as any[];
  assert.deepEqual(
    migrations.map((row) => row.version),
    [1, 2, 3],
  );
  assert.equal(
    Number(
      (
        db
          .prepare(
            "SELECT value_paise FROM clinic_billing_settings WHERE setting_key='consultation-fee'",
          )
          .get() as any
      ).value_paise,
    ),
    50000,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE users SET role='Patient', patient_id=NULL WHERE id='usr-doctor'",
        )
        .run(),
    /Patient role and patient_id must match/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE users SET role='Doctor', patient_id='pat-1042' WHERE id='usr-doctor'",
        )
        .run(),
    /Patient role and patient_id must match/,
  );
  assert.equal(
    (db.prepare("PRAGMA foreign_key_check").all() as any[]).length,
    0,
  );
});

test("demo reset is refused outside explicit development or test mode", async () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => resetAndSeed(),
      /allowed only in explicit development or test mode/,
    );
  } finally {
    process.env.NODE_ENV = original;
  }
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM patients").get() as any).n > 0,
    true,
  );
});

test("npm seed and reset wrappers preserve the production-mode demo-data guard", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "careflow-cli-guard-"));
  const path = join(tempDirectory, "clinic.sqlite");
  const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    for (const script of ["db:seed", "db:reset"]) {
      const result = spawnSync("npm", ["run", script], {
        cwd: backendRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_PATH: path,
        },
        encoding: "utf8",
      });
      assert.notEqual(
        result.status,
        0,
        `${script} must fail in production mode`,
      );
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /allowed only in explicit development or test mode/,
      );
    }
    const check = new DatabaseSync(path);
    try {
      assert.equal(
        (check.prepare("SELECT COUNT(*) AS n FROM patients").get() as any).n,
        0,
      );
    } finally {
      check.close();
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("new accounts require an initial password and Patient accounts require an immutable valid link", async () => {
  const admin = await login("admin01");
  const missingPassword = await call("/users", admin, "POST", {
    id: "usr-phase4-no-pass",
    name: "Test Doctor",
    email: "phase4-doctor@example.test",
    role: "Doctor",
    department: "Cardiology",
    password: "short",
  });
  assert.equal(missingPassword.response.status, 422);

  const missingPatientLink = await call("/users", admin, "POST", {
    id: "usr-phase4-no-link",
    name: "Test Patient",
    email: "phase4-patient@example.test",
    role: "Patient",
    department: "Patient Portal",
    password: "SecureTestPass9",
  });
  assert.equal(missingPatientLink.response.status, 422);

  const created = await call("/users", admin, "POST", {
    id: "usr-phase4-patient",
    name: "Phase Four Patient",
    email: "phase4-patient@example.test",
    role: "Patient",
    department: "Patient Portal",
    patientId: "pat-1047",
    password: "SecureTestPass9",
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.data.loginUsername);
  assert.equal("password" in created.body.data, false);
  assert.equal("passwordHash" in created.body.data, false);
  const patientToken = await login(
    created.body.data.loginUsername,
    "SecureTestPass9",
  );
  const me = await call("/auth/me", patientToken);
  assert.equal(me.body.data.patientId, "pat-1047");

  const reassign = await call("/users/usr-patient-demo", admin, "PUT", {
    patientId: "pat-1047",
  });
  assert.equal(reassign.response.status, 403);
  assert.equal(
    (
      db
        .prepare("SELECT patient_id FROM users WHERE id='usr-patient-demo'")
        .get() as any
    ).patient_id,
    "pat-1042",
  );
});

test("duplicate prescription lines cannot overdraw stock transactionally", async () => {
  const doctor = await login("doctor01");
  const pharmacist = await login("pharmacist1");
  const before = Number(
    (await call("/medicines/med-103", pharmacist)).body.data.stock,
  );
  const quantity = Math.max(1, before);
  const created = await call("/prescriptions", doctor, "POST", {
    patientId: "pat-1042",
    date: dayFromNow(1),
    items: [
      {
        medicineId: "med-103",
        dose: "test",
        quantity,
        instructions: "first line",
      },
      {
        medicineId: "med-103",
        dose: "test",
        quantity: 1,
        instructions: "duplicate line",
      },
    ],
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const result = await call(
    `/prescriptions/${created.body.data.id}/dispense`,
    pharmacist,
    "POST",
    {},
  );
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "INSUFFICIENT_STOCK");
  assert.equal(
    Number((await call("/medicines/med-103", pharmacist)).body.data.stock),
    before,
  );
  assert.equal(
    (await call(`/prescriptions/${created.body.data.id}`, pharmacist)).body.data
      .status,
    "Pending",
  );
});

test("laboratory orders are isolated by stable technician user ID", async () => {
  const admin = await login("admin01");
  const currentTech = await login("labtech1");
  const created = await call("/users", admin, "POST", {
    id: "usr-phase4-labtech",
    name: "Phase Four Technician",
    email: "phase4-lab@example.test",
    role: "Laboratory Technician",
    department: "Laboratory",
    patientId: "",
    password: "SecureLabPass9",
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  db.prepare(
    "UPDATE lab_orders SET assigned_to_user_id=?, assigned_to=? WHERE id=?",
  ).run("usr-phase4-labtech", "Phase Four Technician", "lab-3101");
  const otherTechDenied = await call(
    "/labOrders/lab-3101",
    currentTech,
    "PUT",
    {
      result: "unauthorized result",
      status: "Completed",
    },
  );
  assert.equal(otherTechDenied.response.status, 403);
  const assignedTech = await login(
    created.body.data.loginUsername,
    "SecureLabPass9",
  );
  const visible = await call("/labOrders", assignedTech);
  assert.ok(visible.body.data.some((row: any) => row.id === "lab-3101"));
  const completed = await call("/labOrders/lab-3101", assignedTech, "PUT", {
    result: "Within reference",
    status: "Completed",
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
});

test("zero and excessive payment amounts are rejected without ledger mutations", async () => {
  const admin = await login("admin01");
  const date = dayFromNow(1);
  const invoice = await call("/invoices", admin, "POST", {
    id: "inv-phase4-zero-payment",
    patientId: "pat-1042",
    issuedAt: date,
    dueAt: dayFromNow(10),
    description: "=2+2",
    items: [{ description: "Consultation", quantity: 1, unitPrice: 250.25 }],
  });
  assert.equal(invoice.response.status, 201, JSON.stringify(invoice.body));
  const csvResponse = await fetch(`${base}/api/reports/financial?format=csv`, {
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(csvResponse.status, 200);
  assert.ok((await csvResponse.text()).includes('"\'=2+2"'));
  for (const amount of [0, 0.001, 1e20]) {
    const rejected = await call(
      `/invoices/${invoice.body.data.id}/payments`,
      admin,
      "POST",
      { amount },
    );
    assert.equal(rejected.response.status, 422);
  }
  assert.equal(
    (
      db
        .prepare("SELECT paid_paise FROM invoices WHERE id=?")
        .get(invoice.body.data.id) as any
    ).paid_paise,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM invoice_payments WHERE invoice_id=?",
        )
        .get(invoice.body.data.id) as any
    ).n,
    0,
  );
});

test("patient ID tampering is rejected across clinical, appointment and billing records", async () => {
  const patient = await login("patient1");
  for (const path of [
    "/patients/pat-1043",
    "/appointments/apt-2402",
    "/consultations/con-702",
    "/prescriptions/rx-5502",
    "/labOrders/lab-3102",
    "/invoices/inv-9202",
  ]) {
    const response = await call(path, patient);
    assert.equal(
      response.response.status,
      403,
      `${path}: ${JSON.stringify(response.body)}`,
    );
  }
  for (const path of [
    "/patients/pat-1042",
    "/appointments/apt-2401",
    "/prescriptions/rx-5501",
    "/invoices/inv-9201",
  ]) {
    assert.equal((await call(path, patient)).response.status, 200, path);
  }
});

test("all six roles are denied unrelated administrative and business endpoints server-side", async () => {
  const receptionist = await login("receptionist1");
  const doctor = await login("doctor01");
  const pharmacist = await login("pharmacist1");
  const lab = await login("labtech1");
  const patient = await login("patient1");
  const admin = await login("admin01");
  const checks = [
    [
      "/users",
      receptionist,
      "POST",
      {
        name: "Unauthorized",
        email: "unauthorized@example.test",
        role: "Doctor",
        department: "Test",
        password: "SecureTestPass9",
      },
    ],
    [
      "/medicines/med-101/stock-adjustments",
      doctor,
      "POST",
      { change: 1, note: "role test" },
    ],
    ["/audit", pharmacist],
    ["/invoices", lab],
    ["/audit", patient],
    ["/prescriptions/rx-5501", admin, "PUT", { status: "Cancelled" }],
    ["/labOrders/lab-3101", admin, "PUT", { assignedTo: "Other" }],
  ] as const;
  for (const [path, token, method, body] of checks) {
    const response = await call(path, token, method ?? "GET", body);
    assert.equal(
      response.response.status,
      403,
      `${path}: ${JSON.stringify(response.body)}`,
    );
  }
});

test("notification ownership and mark-read state are persisted per recipient", async () => {
  const { records } = await import("../src/repositories/recordRepository.js");
  records.put("notifications", {
    id: "phase4-private-notification",
    title: "Private test",
    message: "Only the linked patient may see this.",
    at: new Date().toISOString(),
    href: "",
    read: false,
    recipientId: "usr-phase4-patient",
    role: "Patient",
  });
  const username = (
    db
      .prepare(
        "SELECT username FROM credentials WHERE user_id='usr-phase4-patient'",
      )
      .get() as any
  ).username;
  const owner = await login(username, "SecureTestPass9");
  const ownerItems = await call("/notifications", owner);
  assert.ok(
    ownerItems.body.data.some(
      (item: any) => item.id === "phase4-private-notification",
    ),
  );
  const marked = await call(
    "/notifications/phase4-private-notification/read",
    owner,
    "PATCH",
    {},
  );
  assert.equal(marked.response.status, 200);
  assert.equal(marked.body.data.read, true);
  const otherPatient = await login("patient1");
  const hidden = await call(
    "/notifications/phase4-private-notification",
    otherPatient,
  );
  assert.equal(hidden.response.status, 403);
  const deniedRead = await call(
    "/notifications/phase4-private-notification/read",
    otherPatient,
    "PATCH",
    {},
  );
  assert.equal(deniedRead.response.status, 403);
  assert.equal(
    (
      db
        .prepare(
          "SELECT read FROM notifications WHERE id='phase4-private-notification'",
        )
        .get() as any
    ).read,
    1,
  );
});

test("supplier and medicine CRUD works while stock remains behind the adjustment workflow", async () => {
  const pharmacist = await login("pharmacist1");
  const supplier = await call("/suppliers", pharmacist, "POST", {
    id: "sup-phase4-qa",
    name: "Phase Four QA Supplier",
    contact: "QA Contact",
    phone: "5550110",
    email: "supplier.qa@example.test",
    leadDays: 4,
    status: "Active",
  });
  assert.equal(supplier.response.status, 201, JSON.stringify(supplier.body));
  const medicine = await call("/medicines", pharmacist, "POST", {
    id: "med-phase4-qa",
    code: "PH4-QA-001",
    name: "QA Medicine",
    form: "Tablet",
    strength: "25 mg",
    stock: 3,
    minimumStock: 1,
    expiry: dayFromNow(360),
    supplierId: supplier.body.data.id,
    unitPrice: 12.34,
    active: true,
  });
  assert.equal(medicine.response.status, 201, JSON.stringify(medicine.body));
  assert.equal(medicine.body.data.stock, 3);
  const reduce = await call(
    `/medicines/${medicine.body.data.id}/stock-adjustments`,
    pharmacist,
    "POST",
    { change: -3, note: "Use all units" },
  );
  assert.equal(reduce.response.status, 200);
  assert.equal(reduce.body.data.stock, 0);
  const negative = await call(
    `/medicines/${medicine.body.data.id}/stock-adjustments`,
    pharmacist,
    "POST",
    { change: -1, note: "Must fail" },
  );
  assert.equal(negative.response.status, 409);
  assert.equal(negative.body.error.code, "INSUFFICIENT_STOCK");
  const replenish = await call(
    `/medicines/${medicine.body.data.id}/stock-adjustments`,
    pharmacist,
    "POST",
    { change: 5, note: "QA restock" },
  );
  assert.equal(replenish.body.data.stock, 5);
  const update = await call(
    `/medicines/${medicine.body.data.id}`,
    pharmacist,
    "PUT",
    { name: "QA Medicine Updated", unitPrice: 12.35 },
  );
  assert.equal(update.response.status, 200);
  assert.equal(update.body.data.name, "QA Medicine Updated");
  const archived = await call(
    `/medicines/${medicine.body.data.id}`,
    pharmacist,
    "DELETE",
  );
  assert.equal(archived.response.status, 204);
  const archivedRecord = await call(
    `/medicines/${medicine.body.data.id}`,
    pharmacist,
  );
  assert.equal(archivedRecord.response.status, 200);
  assert.equal(archivedRecord.body.data.active, false);
  assert.equal(archivedRecord.body.data.stock, 5);
});

test("rejection notifies the requester and future visits cannot be marked No Show", async () => {
  const patient = await login("patient1");
  const receptionist = await login("receptionist1");
  const request = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor-elise",
    requestedDate: dayFromNow(35),
    requestedTime: "13:30",
    type: "Consultation",
    reason: "Rejection and No Show test",
  });
  assert.equal(request.response.status, 201);
  const rejected = await call(
    `/appointments/${request.body.data.id}/reject`,
    receptionist,
    "POST",
    { reason: "No availability" },
  );
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.data.status, "Rejected");
  const patientNotifications = await call("/notifications", patient);
  assert.ok(
    patientNotifications.body.data.some(
      (item: any) =>
        item.title === "Appointment request rejected" &&
        item.message.includes(request.body.data.id),
    ),
  );

  const approvedRequest = await call("/appointments", patient, "POST", {
    doctorId: "usr-doctor-elise",
    requestedDate: dayFromNow(36),
    requestedTime: "13:30",
    type: "Consultation",
    reason: "Future No Show guard",
  });
  const approved = await call(
    `/appointments/${approvedRequest.body.data.id}/approve`,
    receptionist,
    "POST",
    {},
  );
  assert.equal(approved.response.status, 200);
  const premature = await call(
    `/appointments/${approved.body.data.id}/status`,
    receptionist,
    "PATCH",
    { status: "No Show" },
  );
  assert.equal(premature.response.status, 409);
  assert.equal(
    (await call(`/appointments/${approved.body.data.id}`, patient)).body.data
      .status,
    "Scheduled",
  );
});

test("profile and date preferences remain server-backed and per-user", async () => {
  const patient = await login("patient1");
  const profile = await call("/profile", patient);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.data.userId, "usr-patient-demo");
  const saved = await call("/profile/preferences", patient, "PATCH", {
    dateFormat: "DD/MM/YYYY",
    compactTables: true,
  });
  assert.equal(saved.response.status, 200);
  const reread = await call("/profile/preferences", patient);
  assert.deepEqual(reread.body.data, {
    dateFormat: "DD/MM/YYYY",
    compactTables: true,
  });
  const doctor = await login("doctor01");
  const doctorPrefs = await call("/profile/preferences", doctor);
  assert.deepEqual(doctorPrefs.body.data, {
    dateFormat: "MMM D, YYYY",
    compactTables: false,
  });
});
