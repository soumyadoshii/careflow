import type { DatabaseSync } from "node:sqlite";
import { initialSchema } from "./migrations/001_initial.js";
import { integritySchema } from "./migrations/002_integrity.js";
import { consultationBillingSchema } from "./migrations/003_consultation_billing.js";

const migrations = [
  { version: 1, name: "normalized_careflow_schema", sql: initialSchema },
  {
    version: 2,
    name: "integrity_and_assignment_hardening",
    sql: integritySchema,
  },
  {
    version: 3,
    name: "consultation_billing_and_fee_setting",
    sql: consultationBillingSchema,
  },
] as const;

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  for (const migration of migrations) {
    const applied = database
      .prepare("SELECT 1 AS yes FROM schema_migrations WHERE version=?")
      .get(migration.version);
    if (applied) continue;
    database.exec("BEGIN EXCLUSIVE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        /* migration transaction already closed */
      }
      throw error;
    }
  }
}
