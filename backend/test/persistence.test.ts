import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("SQLite seed survives a process restart and repeat seed is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "careflow-phase3-persist-"));
  const dbPath = join(dir, "restart.sqlite");
  const env = {
    ...process.env,
    DATABASE_PATH: dbPath,
    NODE_ENV: "development",
    JWT_SECRET: "test-only-secret-with-more-than-32-characters",
  };
  const run = (command: string) =>
    execFileSync(
      process.execPath,
      ["--experimental-sqlite", "--import", "tsx", "src/db/cli.ts", command],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
  try {
    const seeded = run("seed");
    assert.match(seeded, /'patients':?\s*10|"patients":10/);
    const verified = JSON.parse(run("verify"));
    assert.equal(verified.integrity, "ok");
    assert.equal(verified.foreignKeyViolations, 0);
    assert.equal(verified.seed.patients, 10);
    assert.equal(verified.seed.users, 12);

    // Simulate the current populated database before patient2–patient5 were added.
    const populated = new DatabaseSync(dbPath);
    for (const [id, username] of [
      ["usr-patient-2", "patient2"],
      ["usr-patient-3", "patient3"],
      ["usr-patient-4", "patient4"],
      ["usr-patient-5", "patient5"],
    ]) {
      populated.prepare("DELETE FROM credentials WHERE username=?").run(username);
      populated.prepare("DELETE FROM users WHERE id=?").run(id);
    }
    populated.close();
    const beforeAdditiveSeed = JSON.parse(run("verify"));
    assert.equal(beforeAdditiveSeed.seed.users, 8);

    const seededAgain = run("seed");
    assert.match(seededAgain, /'patients':?\s*10|"patients":10/);
    const after = JSON.parse(run("verify"));
    assert.equal(after.seed.patients, 10);
    assert.equal(after.seed.users, 12);
    assert.equal(after.seed.invoices, 8);
    for (const collection of [
      "appointments",
      "consultations",
      "prescriptions",
      "labOrders",
      "invoices",
      "audit",
      "notifications",
    ])
      assert.equal(
        after.seed[collection],
        beforeAdditiveSeed.seed[collection],
        `${collection} were changed by additive account seeding`,
      );
    const accounts = new DatabaseSync(dbPath, { readOnly: true });
    for (const [username, patientId] of [
      ["patient2", "pat-1043"],
      ["patient3", "pat-1044"],
      ["patient4", "pat-1045"],
      ["patient5", "pat-1046"],
    ]) {
      const row = accounts
        .prepare(
          "SELECT u.role,u.patient_id,c.username FROM users u JOIN credentials c ON c.user_id=u.id WHERE c.username=?",
        )
        .get(username) as any;
      assert.equal(row.role, "Patient");
      assert.equal(row.patient_id, patientId);
      assert.equal(row.username, username);
    }
    accounts.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
