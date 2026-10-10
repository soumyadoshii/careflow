import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, transaction, verifyDatabase } from "./database.js";
import { records } from "../repositories/recordRepository.js";
import { seedData } from "../domain/seed.js";

const usernameByUserId: Record<string, string> = {
  "usr-admin": "admin01",
  "usr-reception": "receptionist1",
  "usr-doctor": "doctor01",
  "usr-doctor-elise": "doctor02",
  "usr-doctor-mei": "doctor03",
  "usr-pharmacist": "pharmacist1",
  "usr-lab": "labtech1",
  "usr-patient-demo": "patient1",
};
const additionalPatientAccounts = [
  {
    username: "patient2",
    user: {
      id: "usr-patient-2",
      name: "Daniel Kim",
      email: "daniel.kim@example.test",
      role: "Patient",
      department: "Patient",
      status: "Active",
      lastActive: "2026-10-02 08:08",
      patientId: "pat-1043",
    },
  },
  {
    username: "patient3",
    user: {
      id: "usr-patient-3",
      name: "Aisha Rahman",
      email: "aisha.rahman@example.test",
      role: "Patient",
      department: "Patient",
      status: "Active",
      lastActive: "2026-10-02 08:07",
      patientId: "pat-1044",
    },
  },
  {
    username: "patient4",
    user: {
      id: "usr-patient-4",
      name: "Mateo Rivera",
      email: "mateo.rivera@example.test",
      role: "Patient",
      department: "Patient",
      status: "Active",
      lastActive: "2026-10-02 08:06",
      patientId: "pat-1045",
    },
  },
  {
    username: "patient5",
    user: {
      id: "usr-patient-5",
      name: "Noor Siddiqui",
      email: "noor.siddiqui@example.test",
      role: "Patient",
      department: "Patient",
      status: "Active",
      lastActive: "2026-10-02 08:05",
      patientId: "pat-1046",
    },
  },
] as const;
const seedOrder = [
  "patients",
  "users",
  "suppliers",
  "settings",
  "appointments",
  "availabilityBlocks",
  "consultations",
  "medicines",
  "prescriptions",
  "labOrders",
  "procurement",
  "invoices",
  "audit",
  "notifications",
] as const;
function assertDemoDatabaseCommand(command: string): void {
  if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
    throw new Error(
      `Demo database ${command} is allowed only in explicit development or test mode.`,
    );
}
function fanOutBroadcastNotifications(): void {
  transaction(() => {
    const activeUsers = records
      .list("users")
      .filter((u: any) => u.status === "Active");
    for (const item of records.list("notifications")) {
      if (
        item.recipientId ||
        ![
          "All staff",
          "Clinic Administrator",
          "Receptionist",
          "Doctor",
          "Pharmacist",
          "Laboratory Technician",
          "Patient",
        ].includes(item.role)
      )
        continue;
      const targets = activeUsers.filter((u: any) =>
        item.role === "All staff" ? u.role !== "Patient" : u.role === item.role,
      );
      for (const user of targets)
        records.put("notifications", {
          ...item,
          id: `${item.id}-${user.id}`,
          recipientId: user.id,
        });
      if (targets.length) records.remove("notifications", item.id);
    }
  });
}
export function seedIfEmpty(): void {
  assertDemoDatabaseCommand("seeding");
  const freshDatabase = records.count("patients") === 0;
  if (freshDatabase) {
    transaction(() => {
      for (const collection of seedOrder)
        for (const item of (seedData as any)[collection])
          records.put(collection, item);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO credentials(user_id,username,password_hash) VALUES (?,?,?)",
      );
      for (const [userId, username] of Object.entries(usernameByUserId))
        insert.run(userId, username, bcrypt.hashSync("demo123", 10));
    });
  }
  transaction(() => {
    const findPatient = db.prepare("SELECT user_id,username FROM credentials WHERE username=?");
    const findCredential = db.prepare("SELECT username FROM credentials WHERE user_id=?");
    const insertCredential = db.prepare(
      "INSERT INTO credentials(user_id,username,password_hash) VALUES (?,?,?)",
    );
    for (const account of additionalPatientAccounts) {
      let patient = records.get("patients", account.user.patientId);
      if (!patient) {
        const seededPatient = seedData.patients.find(
          (item) => item.id === account.user.patientId,
        );
        if (!seededPatient)
          throw new Error(`Seed patient ${account.user.patientId} is missing.`);
        patient = seededPatient;
        records.put("patients", patient);
      }
      const user = records.get("users", account.user.id);
      if (
        user &&
        (user.role !== "Patient" || user.patientId !== account.user.patientId)
      )
        throw new Error(`Demo account ${account.username} conflicts with an existing user.`);
      if (!user) {
        const linkedUser = records
          .list("users")
          .find(
            (item: any) =>
              item.role === "Patient" &&
              item.patientId === account.user.patientId,
          );
        if (linkedUser)
          throw new Error(
            `Patient ${account.user.patientId} is already linked to another user.`,
          );
        records.put("users", { ...account.user, name: patient.name });
      }
      const credential = findCredential.get(account.user.id) as
        | { username: string }
        | undefined;
      const usernameOwner = findPatient.get(account.username) as
        | { user_id: string; username: string }
        | undefined;
      if (credential && credential.username !== account.username)
        throw new Error(`Demo user ${account.user.id} already has another username.`);
      if (usernameOwner && usernameOwner.user_id !== account.user.id)
        throw new Error(`Demo username ${account.username} is already in use.`);
      if (!credential)
        insertCredential.run(
          account.user.id,
          account.username,
          bcrypt.hashSync("demo123", 10),
        );
    }
  });
  if (freshDatabase) fanOutBroadcastNotifications();
}
export function resetAndSeed(): void {
  assertDemoDatabaseCommand("reset");
  transaction(() => records.clear());
  seedIfEmpty();
  const check = verifyDatabase();
  if (check.integrity !== "ok" || check.foreignKeyViolations)
    throw new Error("Database reset completed with integrity errors.");
}
export function seedCounts(): Record<string, number> {
  return Object.fromEntries(
    seedOrder.map((collection) => [collection, records.count(collection)]),
  );
}
