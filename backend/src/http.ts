import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "./db/database.js";
import { records } from "./repositories/recordRepository.js";
import type { Role } from "./domain/types.js";
export type Identity = {
  userId: string;
  name: string;
  role: Role;
  patientId?: string;
  department: string;
};
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const ok = (
  res: Response,
  data: unknown,
  status = 200,
  meta?: unknown,
) =>
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
export const fail = (
  res: Response,
  status: number,
  code: string,
  message: string,
) => res.status(status).json({ success: false, error: { code, message } });
export const roles = [
  "Clinic Administrator",
  "Receptionist",
  "Doctor",
  "Pharmacist",
  "Laboratory Technician",
  "Patient",
] as const;
const secret = randomBytes(48).toString("hex");
export const jwtSecret = process.env.JWT_SECRET ?? secret;
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
)
  throw new Error(
    "JWT_SECRET must be set to at least 32 random characters in production.",
  );
type Payload = jwt.JwtPayload & { sub: string; ver: number };
export function issueToken(i: Identity, v: number) {
  return jwt.sign({ sub: i.userId, ver: v }, jwtSecret, {
    expiresIn: "8h",
    issuer: "careflow-phase3",
  });
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.get("authorization") ?? "";
    if (!h.startsWith("Bearer "))
      throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
    const p = jwt.verify(h.slice(7), jwtSecret, {
      issuer: "careflow-phase3",
    }) as Payload;
    const u = records.get("users", p.sub);
    const c = db
      .prepare("SELECT token_version FROM credentials WHERE user_id=?")
      .get(p.sub) as any;
    if (!u || u.status !== "Active" || !c || c.token_version !== p.ver)
      throw new ApiError(
        401,
        "AUTH_INVALID",
        "Authentication is invalid or expired.",
      );
    req.identity = {
      userId: u.id,
      name: u.name,
      role: u.role,
      patientId: u.patientId,
      department: u.department,
    };
    next();
  } catch (e) {
    next(
      e instanceof ApiError
        ? e
        : new ApiError(
            401,
            "AUTH_INVALID",
            "Authentication is invalid or expired.",
          ),
    );
  }
}
export function requireRole(...rs: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.identity)
      return next(
        new ApiError(401, "AUTH_REQUIRED", "Authentication is required."),
      );
    if (!rs.includes(req.identity.role))
      return next(
        new ApiError(
          403,
          "FORBIDDEN",
          "You are not authorized to perform this action.",
        ),
      );
    next();
  };
}
export function requireIdentity(req: Request): Identity {
  if (!req.identity)
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  return req.identity;
}
export function safeErrorHandler(
  e: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) return;
  if (e instanceof ApiError) return void fail(res, e.status, e.code, e.message);
  if (e instanceof Error && e.name === "ZodError")
    return void fail(
      res,
      422,
      "VALIDATION_ERROR",
      "Request fields are invalid.",
    );
  console.error(
    "[careflow-api]",
    e instanceof Error ? e.message : "Unknown error",
  );
  fail(res, 500, "INTERNAL_ERROR", "An unexpected server error occurred.");
}
