import "dotenv/config";
import { migrateDatabase } from "./migrations.js";
import { db, databasePath, verifyDatabase } from "./database.js";
import { resetAndSeed, seedCounts, seedIfEmpty } from "./seed.js";
const command = process.argv[2] ?? "help";
if (command === "migrate") {
  migrateDatabase(db);
  console.log(`Migrations applied at ${databasePath}.`);
} else if (command === "seed") {
  seedIfEmpty();
  console.log(
    `Seed verified at ${databasePath}: ${JSON.stringify(seedCounts())}`,
  );
} else if (command === "reset") {
  resetAndSeed();
  console.log(
    `Development database reset and seeded at ${databasePath}: ${JSON.stringify(seedCounts())}`,
  );
} else if (command === "verify") {
  const result = verifyDatabase();
  console.log(
    JSON.stringify(
      { path: databasePath, ...result, seed: seedCounts() },
      null,
      2,
    ),
  );
  if (result.integrity !== "ok" || result.foreignKeyViolations)
    process.exitCode = 1;
} else {
  console.log(
    "Usage: npm run db:migrate | NODE_ENV=development npm run db:seed | NODE_ENV=development npm run db:reset | npm run db:verify",
  );
}
