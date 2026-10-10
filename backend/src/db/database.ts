import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "./migrations.js";
const configured = process.env.DATABASE_PATH ?? "./data/careflow.sqlite";
export const databasePath =
  configured === ":memory:" ? configured : resolve(process.cwd(), configured);
if (databasePath !== ":memory:")
  mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(
  "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
);
migrateDatabase(db);
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}
export function withSavepoint<T>(fn: () => T): T {
  db.exec("SAVEPOINT careflow_record_write");
  try {
    const result = fn();
    db.exec("RELEASE careflow_record_write");
    return result;
  } catch (e) {
    db.exec("ROLLBACK TO careflow_record_write; RELEASE careflow_record_write");
    throw e;
  }
}
export function verifyDatabase() {
  const integrity = (db.prepare("PRAGMA integrity_check").get() as any)
    .integrity_check;
  const foreignKeyViolations = db
    .prepare("PRAGMA foreign_key_check")
    .all().length;
  const migrations = Number(
    (db.prepare("SELECT count(*) n FROM schema_migrations").get() as any).n,
  );
  return { integrity, foreignKeyViolations, migrations };
}
