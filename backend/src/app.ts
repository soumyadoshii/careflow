import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { ok, fail, safeErrorHandler } from "./http.js";
import { apiRouter } from "./routes/api.js";

export const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://127.0.0.1:3000")
      .split(",")
      .map((origin) => origin.trim()),
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_req, res) =>
  ok(res, { status: "ok", database: "sqlite", phase: "3" }),
);
app.use("/api", apiRouter);
app.use((error: any, req: Request, res: Response, next: any) => {
  if (error instanceof Error && error.name === "ZodError")
    return fail(res, 422, "VALIDATION_ERROR", "Request fields are invalid.");
  return safeErrorHandler(error, req, res, next);
});

export default app;
