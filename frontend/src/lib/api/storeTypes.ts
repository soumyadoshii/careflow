import type { EntityMap } from "./types";

/** Typed collections returned by the backend dashboard snapshot; never browser persistence. */
export type ClinicDataSnapshot = { [K in keyof EntityMap]: EntityMap[K][] };
