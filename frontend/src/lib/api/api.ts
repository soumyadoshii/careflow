import type {
  DemoSession,
  Role,
  Appointment,
  AppointmentStatus,
  AvailabilityBlock,
  Patient,
  CollectionName,
  EntityMap,
  EntityOf,
  NewEntity,
} from "./types";
import {
  getAuthToken,
  saveBackendSession,
  clearBackendSession,
} from "../auth/session";
import {
  moneyToPaise,
  paiseToRupees,
  setDateFormatPreference,
} from "../format";
import type { ClinicDataSnapshot } from "./storeTypes";
import type {
  ReportFormat,
  ReportKind,
  ReportRequest,
  ReportRow,
} from "../reports/types";

export type DemoDateFormat = "MMM D, YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
export interface DemoPreferences {
  dateFormat: DemoDateFormat;
  compactTables: boolean;
}
export interface AppointmentSlotCheck {
  time: string;
  canSchedule: boolean;
  patientConflict: string;
  doctorConflict: string;
  message: string;
}
export interface AppointmentReviewData {
  appointment: Appointment;
  patient?: Patient;
  patients: Patient[];
  patientSchedule: Appointment[];
  doctorSchedule: Appointment[];
  patientBlocks: AvailabilityBlock[];
  doctorBlocks: AvailabilityBlock[];
  nearbySlots: AppointmentSlotCheck[];
}
export interface AppointmentDashboardSummary {
  pendingCount: number;
  todayConfirmedCount: number;
  todayBlocksCount: number;
  conflictingRequestsCount: number;
  todayAppointments: Appointment[];
  pendingRequests: Appointment[];
}
export interface LoginResult {
  token: string;
  user: DemoSession;
}
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(
  /\/$/,
  "",
);
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
async function request<T>(
  path: string,
  method: Method = "GET",
  body?: unknown,
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const token = getAuthToken();
  if (auth && token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const payload = await response.json();
      message = payload?.error?.message ?? message;
    } catch {}
    if (response.status === 401 && auth) {
      clearBackendSession();
      window.dispatchEvent(new Event("careflow:session-expired"));
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (payload && typeof payload === "object" && "success" in payload)
    return payload.data as T;
  return payload as T;
}
function query(values: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined && v !== "") p.set(k, v);
  const text = p.toString();
  return text ? `?${text}` : "";
}
const signalChanged = () =>
  window.dispatchEvent(new Event("careflow:notifications-updated"));

async function login(username: string, password: string): Promise<DemoSession> {
  const result = await request<{ token: string; user: DemoSession }>(
    "/auth/login",
    "POST",
    { username, password },
    false,
  );
  saveBackendSession(result.user, result.token);
  return result.user;
}
async function getCurrentSession(): Promise<DemoSession> {
  const user = await request<DemoSession>("/auth/me");
  return user;
}
async function logout(): Promise<void> {
  try {
    await request("/auth/logout", "POST", {});
  } finally {
    clearBackendSession();
  }
}
async function changePassword(currentPassword: string, newPassword: string) {
  return request("/profile/password", "PUT", { currentPassword, newPassword });
}
async function list<K extends CollectionName>(
  collection: K,
): Promise<EntityMap[K][]> {
  return request<EntityMap[K][]>(`/${encodeURIComponent(collection)}`);
}
async function create<K extends CollectionName>(
  collection: K,
  input: NewEntity<EntityOf<K>>,
): Promise<EntityOf<K>> {
  const result = await request<EntityOf<K>>(
    `/${encodeURIComponent(collection)}`,
    "POST",
    input,
  );
  signalChanged();
  return result;
}
async function update<K extends CollectionName>(
  collection: K,
  id: string,
  patch: Partial<EntityOf<K>>,
): Promise<EntityOf<K>> {
  const result = await request<EntityOf<K>>(
    `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    "PUT",
    patch,
  );
  signalChanged();
  return result;
}
async function archive(collection: CollectionName, id: string): Promise<void> {
  await request(
    `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    "DELETE",
  );
  signalChanged();
}
async function getSnapshot(): Promise<ClinicDataSnapshot> {
  return request<ClinicDataSnapshot>("/dashboard/snapshot");
}
async function getDashboardSnapshotForSession(): Promise<ClinicDataSnapshot> {
  return getSnapshot();
}
async function listAppointmentsForSession(): Promise<Appointment[]> {
  return request("/appointments");
}
async function listAppointmentPatients(): Promise<Patient[]> {
  return request("/patients");
}
async function listActiveDoctors() {
  return request<any[]>("/users/doctors");
}
async function listAvailabilityBlocksForSession(): Promise<
  AvailabilityBlock[]
> {
  return request("/availabilityBlocks");
}
async function getPreferences(): Promise<DemoPreferences> {
  const value = await request<DemoPreferences>("/profile/preferences");
  setDateFormatPreference(value.dateFormat);
  return value;
}
async function updatePreferences(
  patch: Partial<DemoPreferences>,
): Promise<DemoPreferences> {
  const value = await request<DemoPreferences>(
    "/profile/preferences",
    "PATCH",
    patch,
  );
  setDateFormatPreference(value.dateFormat);
  return value;
}
async function adjustMedicineStock(
  id: string,
  change: number,
  note: string,
): Promise<void> {
  await request(
    `/medicines/${encodeURIComponent(id)}/stock-adjustments`,
    "POST",
    { change, note },
  );
  signalChanged();
}
async function dispensePrescription(id: string): Promise<void> {
  await request(
    `/prescriptions/${encodeURIComponent(id)}/dispense`,
    "POST",
    {},
  );
  signalChanged();
}
async function receiveProcurement(id: string): Promise<void> {
  await request(`/procurement/${encodeURIComponent(id)}/receive`, "POST", {});
  signalChanged();
}
async function markNotificationRead(id: string): Promise<void> {
  await request(`/notifications/${encodeURIComponent(id)}/read`, "PATCH", {});
  signalChanged();
}
async function setInvoicePayment(id: string, paid: number): Promise<void> {
  const invoices = await list("invoices");
  const invoice = invoices.find((x) => x.id === id);
  if (!invoice) throw new Error("Invoice was not found.");
  if (!Number.isFinite(paid) || paid < invoice.paid || paid > invoice.total)
    throw new Error(
      "Payment cannot be negative or exceed the outstanding balance.",
    );
  const amount = paiseToRupees(moneyToPaise(paid) - moneyToPaise(invoice.paid));
  if (amount === 0) return;
  await request(`/invoices/${encodeURIComponent(id)}/payments`, "POST", {
    amount,
    method: "Counter",
  });
  signalChanged();
}
async function requestAppointment(input: {
  patientId?: string;
  doctorId?: string;
  department?: string;
  requestedDate: string;
  requestedTime: string;
  type: string;
  reason: string;
}): Promise<Appointment> {
  const v = await request<Appointment>("/appointments", "POST", input);
  signalChanged();
  return v;
}
async function checkAppointmentAvailability(input: {
  patientId: string;
  doctorId: string;
  date: string;
  time: string;
  excludeAppointmentId?: string;
}): Promise<AppointmentSlotCheck> {
  return request(`/appointments/availability/check${query(input)}`);
}
async function findAvailableAppointmentSlots(input: {
  patientId: string;
  doctorId: string;
  date: string;
  excludeAppointmentId?: string;
}): Promise<AppointmentSlotCheck[]> {
  return request(`/appointments/availability/slots${query(input)}`);
}
async function getAppointmentReview(
  id: string,
): Promise<AppointmentReviewData> {
  return request(`/appointments/${encodeURIComponent(id)}/review`);
}
async function approveAppointment(id: string): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/approve`,
    "POST",
    {},
  );
  signalChanged();
  return v;
}
async function proposeAppointmentTime(
  id: string,
  date: string,
  time: string,
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/propose-time`,
    "POST",
    { date, time },
  );
  signalChanged();
  return v;
}
async function acceptProposedAppointmentTime(id: string): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/accept-proposed-time`,
    "POST",
    {},
  );
  signalChanged();
  return v;
}
async function rejectAppointment(
  id: string,
  reason: string,
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/reject`,
    "POST",
    { reason },
  );
  signalChanged();
  return v;
}
async function requestAppointmentReschedule(
  id: string,
  input: { date: string; time: string; reason: string },
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/reschedule-request`,
    "POST",
    input,
  );
  signalChanged();
  return v;
}
async function requestAppointmentCancellation(
  id: string,
  reason: string,
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/cancellation-request`,
    "POST",
    { reason },
  );
  signalChanged();
  return v;
}
async function cancelAppointment(
  id: string,
  reason: string,
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/cancel`,
    "POST",
    { reason },
  );
  signalChanged();
  return v;
}
async function transitionAppointment(
  id: string,
  status: AppointmentStatus,
): Promise<Appointment> {
  const v = await request<Appointment>(
    `/appointments/${encodeURIComponent(id)}/status`,
    "PATCH",
    { status },
  );
  signalChanged();
  return v;
}
async function getAppointmentDashboardSummary(
  today: string,
): Promise<AppointmentDashboardSummary> {
  return request(`/appointments/dashboard-summary${query({ today })}`);
}
async function reset(): Promise<void> {
  await request("/dev/reset", "POST", {});
  clearBackendSession();
}
async function reportData(
  kind: ReportKind,
  range: ReportRequest,
): Promise<ReportRow[]> {
  const payload = await request<{ rows: ReportRow[] }>(
    `/reports/${kind}${query({ from: range.from, to: range.to })}`,
  );
  return Array.isArray(payload) ? payload : payload.rows;
}
async function reportFile(
  kind: ReportKind,
  format: ReportFormat,
  range: ReportRequest,
): Promise<Blob> {
  const token = getAuthToken();
  if (!token) {
    window.dispatchEvent(new Event("careflow:session-expired"));
    throw new Error("Your session has expired. Sign in again.");
  }
  const response = await fetch(
    `${API_BASE}/reports/${kind}${query({ ...range, format })}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept:
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    },
  );
  if (!response.ok) {
    let message = `Report export failed (${response.status}).`;
    try {
      message = (await response.json())?.error?.message ?? message;
    } catch {}
    if (response.status === 401) {
      clearBackendSession();
      window.dispatchEvent(new Event("careflow:session-expired"));
    }
    throw new Error(message);
  }
  return response.blob();
}
export const api = {
  login,
  getCurrentSession,
  logout,
  changePassword,
  list,
  create,
  update,
  archive,
  getSnapshot,
  getDashboardSnapshotForSession,
  listAppointmentsForSession,
  listAppointmentPatients,
  listActiveDoctors,
  listAvailabilityBlocksForSession,
  getPreferences,
  updatePreferences,
  adjustMedicineStock,
  dispensePrescription,
  receiveProcurement,
  markNotificationRead,
  setInvoicePayment,
  requestAppointment,
  checkAppointmentAvailability,
  findAvailableAppointmentSlots,
  getAppointmentReview,
  approveAppointment,
  proposeAppointmentTime,
  acceptProposedAppointmentTime,
  rejectAppointment,
  requestAppointmentReschedule,
  requestAppointmentCancellation,
  cancelAppointment,
  transitionAppointment,
  getAppointmentDashboardSummary,
  reset,
  reports: { data: reportData, file: reportFile },
};
export type { ReportFormat, ReportKind, ReportRequest, ReportRow };
export type { Prescription, ProcurementOrder } from "./types";
