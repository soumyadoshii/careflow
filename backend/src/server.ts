import "dotenv/config";
import { app } from "./app.js";
import { databasePath } from "./db/database.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
const server = app.listen(port, host, () => {
  console.log(`Careflow Phase 3 API listening at http://${host}:${port}`);
  console.log(`Relational SQLite database: ${databasePath}`);
  if (!process.env.JWT_SECRET)
    console.warn(
      "JWT_SECRET is unset; a process-local random secret is in use. Set a unique secret in .env for stable local sessions.",
    );
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
