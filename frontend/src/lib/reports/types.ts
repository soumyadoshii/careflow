export type ReportKind = "financial" | "operational";
export type ReportFormat = "pdf" | "xlsx";
export interface ReportRequest {
  from: string;
  to: string;
}
export type ReportRow = Record<string, string | number>;
