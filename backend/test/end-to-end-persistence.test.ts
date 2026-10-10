import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("API-created clinic records, money, inventory, notifications and audit survive backend process restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "careflow-phase4-e2e-persist-"));
  const dbPath = join(dir, "careflow.sqlite");
  const manifestPath = join(dir, "manifest.json");
  const env = {
    ...process.env,
    DATABASE_PATH: dbPath,
    MANIFEST_PATH: manifestPath,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    CLINIC_TIME_ZONE: "Asia/Kolkata",
    JWT_SECRET: "phase4-persistence-test-secret-with-32-chars",
    LOGIN_MAX_ATTEMPTS: "5",
  };
  const run = (source: string) =>
    execFileSync(
      process.execPath,
      [
        "--experimental-sqlite",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        source,
      ],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: 45_000,
        maxBuffer: 4_000_000,
      },
    );
  const createAndUseThroughApi = String.raw`
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    const { app } = await import('./src/app.ts');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    async function request(path, token, method='GET', body) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const json = response.status === 204 ? null : await response.json();
      assert.ok(response.ok, method + ' ' + path + ' => ' + response.status + ' ' + JSON.stringify(json));
      return json?.data;
    }
    async function login(username, password='demo123') {
      return (await request('/auth/login', undefined, 'POST', { username, password })).token;
    }
    function futureDate(days) {
      const d = new Date(); d.setDate(d.getDate() + days);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    const manifest = {};
    try {
      const admin = await login('admin01');
      const reception = await login('receptionist1');
      const doctor = await login('doctor01');
      const pharmacy = await login('pharmacist1');
      const labTech = await login('labtech1');
      const patient = await request('/patients', admin, 'POST', {
        id: 'pat-phase4-persist', name: 'Persistence Test Patient', dateOfBirth: '1990-01-01',
        sex: 'Other', phone: '5550104', email: 'persist.patient@example.test', bloodGroup: 'O+',
        emergencyContact: 'Persistence Contact', status: 'Active'
      });
      manifest.patientId = patient.id;
      const user = await request('/users', admin, 'POST', {
        id: 'usr-phase4-persist-patient', name: 'Persistence Test Patient', email: 'persist.login@example.test',
        role: 'Patient', department: 'Patient Portal', patientId: patient.id, password: 'PersistencePass9'
      });
      const patientToken = await login(user.loginUsername, 'PersistencePass9');
      const date = futureDate(21);
      const appointment = await request('/appointments', patientToken, 'POST', {
        doctorId: 'usr-doctor', department: 'General Medicine', requestedDate: date, requestedTime: '15:00',
        type: 'Consultation', reason: 'Restart persistence workflow'
      });
      manifest.appointmentId = appointment.id;
      assert.equal(appointment.status, 'Pending Approval');
      const receptionistNotifications = await request('/notifications', reception);
      assert.ok(receptionistNotifications.some(item => item.title === 'Patient appointment request'));
      const scheduled = await request('/appointments/' + appointment.id + '/approve', reception, 'POST', {});
      assert.equal(scheduled.status, 'Scheduled');
      const ownAppointments = await request('/appointments', patientToken);
      assert.ok(ownAppointments.some(item => item.id === appointment.id));
      await request('/appointments/' + appointment.id + '/status', reception, 'PATCH', { status: 'Checked In' });
      const consultation = await request('/consultations', doctor, 'POST', {
        appointmentId: appointment.id, reason: 'Persistence consult', notes: 'Saved through API', date, status: 'Waiting'
      });
      manifest.consultationId = consultation.id;
      const prescription = await request('/prescriptions', doctor, 'POST', {
        patientId: patient.id, date, items: [{ medicineId: 'med-101', dose: 'One tablet', quantity: 1, instructions: 'Persistence test' }]
      });
      manifest.prescriptionId = prescription.id;
      const stockBefore = Number((await request('/medicines/med-101', pharmacy)).stock);
      await request('/prescriptions/' + prescription.id, pharmacy, 'PUT', { status: 'Ready for Pickup' });
      const dispensed = await request('/prescriptions/' + prescription.id + '/dispense', pharmacy, 'POST', {});
      assert.equal(dispensed.status, 'Dispensed');
      await request('/medicines/med-101/stock-adjustments', pharmacy, 'POST', { change: 5, note: 'Restart persistence test' });
      manifest.stockBefore = stockBefore;
      const procurement = await request('/procurement', pharmacy, 'POST', {
        supplierId: 'sup-01', createdAt: date, expectedAt: futureDate(30),
        items: [{ medicineId: 'med-101', quantity: 2 }]
      });
      manifest.procurementId = procurement.id;
      await request('/procurement/' + procurement.id, pharmacy, 'PUT', { status: 'Submitted' });
      await request('/procurement/' + procurement.id, pharmacy, 'PUT', { status: 'Approved' });
      const receivedOrder = await request('/procurement/' + procurement.id + '/receive', pharmacy, 'POST', {});
      assert.equal(receivedOrder.status, 'Received');
      const labOrder = await request('/labOrders', doctor, 'POST', {
        patientId: patient.id, test: 'Persistence test panel', priority: 'Routine', assignedTo: 'Ethan Brooks', referenceRange: 'See report'
      });
      manifest.labOrderId = labOrder.id;
      await request('/labOrders/' + labOrder.id, labTech, 'PUT', { status: 'Collected' });
      await request('/labOrders/' + labOrder.id, labTech, 'PUT', { status: 'Processing' });
      await request('/labOrders/' + labOrder.id, labTech, 'PUT', { status: 'Completed', result: 'Persisted result' });
      await request('/labOrders/' + labOrder.id, labTech, 'PUT', { status: 'Reviewed' });
      const invoice = await request('/invoices', reception, 'POST', {
        patientId: patient.id, issuedAt: date, dueAt: futureDate(30), description: 'Restart persistence invoice',
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500.5 }]
      });
      manifest.invoiceId = invoice.id;
      assert.equal(invoice.total, 500.5);
      await request('/invoices/' + invoice.id + '/payments', reception, 'POST', { amount: 100.25, method: 'Cash' });
      const patientNotifications = await request('/notifications', patientToken);
      const notification = patientNotifications.find(item => item.title.toLowerCase().includes('appointment'));
      assert.ok(notification, 'patient should receive an appointment notification');
      manifest.notificationId = notification.id;
      await request('/notifications/' + notification.id + '/read', patientToken, 'PATCH', {});
      const audits = await request('/audit', admin);
      assert.ok(audits.some(item => item.recordId === appointment.id));
      writeFileSync(process.env.MANIFEST_PATH, JSON.stringify(manifest));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  `;
  const verifyAfterRestart = String.raw`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const m = JSON.parse(readFileSync(process.env.MANIFEST_PATH, 'utf8'));
    const { db, verifyDatabase } = await import('./src/db/database.ts');
    const one = (sql, ...args) => db.prepare(sql).get(...args);
    assert.ok(one('SELECT id FROM patients WHERE id=?', m.patientId));
    assert.equal(one('SELECT status FROM appointments WHERE id=?', m.appointmentId).status, 'Checked In');
    assert.ok(one('SELECT id FROM consultations WHERE id=?', m.consultationId));
    assert.equal(one('SELECT status FROM prescriptions WHERE id=?', m.prescriptionId).status, 'Dispensed');
    assert.equal(one('SELECT stock FROM medicines WHERE id=?', 'med-101').stock, m.stockBefore + 6);
    assert.equal(one('SELECT status FROM procurement_orders WHERE id=?', m.procurementId).status, 'Received');
    assert.ok(one('SELECT COUNT(*) AS n FROM audit WHERE record_id=?', m.procurementId).n > 0);
    const lab = one('SELECT status,result FROM lab_orders WHERE id=?', m.labOrderId);
    assert.equal(lab.status, 'Reviewed'); assert.equal(lab.result, 'Persisted result');
    const invoice = one('SELECT total_paise,paid_paise FROM invoices WHERE id=?', m.invoiceId);
    assert.equal(invoice.total_paise, 50050); assert.equal(invoice.paid_paise, 10025);
    assert.equal(one('SELECT read FROM notifications WHERE id=?', m.notificationId).read, 1);
    assert.ok(one('SELECT COUNT(*) AS n FROM audit WHERE record_id=?', m.appointmentId).n > 0);
    const integrity = verifyDatabase();
    assert.equal(integrity.integrity, 'ok'); assert.equal(integrity.foreignKeyViolations, 0);
    console.log('api-write-restart-verify-ok');
  `;
  try {
    const envSeed = { ...env, NODE_ENV: "development" };
    execFileSync(
      process.execPath,
      ["--experimental-sqlite", "--import", "tsx", "src/db/cli.ts", "seed"],
      { cwd: process.cwd(), env: envSeed, encoding: "utf8", timeout: 30_000 },
    );
    run(createAndUseThroughApi);
    assert.ok(readFileSync(manifestPath, "utf8").length > 0);
    const verified = run(verifyAfterRestart);
    assert.match(verified, /api-write-restart-verify-ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
