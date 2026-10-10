import type { DemoSession, NotificationRecord, Role } from "../api/types";
const SESSION_KEY = "careflow.backend-session.v1";
const TOKEN_KEY = "careflow.backend-token.v1";
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function getSession(): DemoSession | null {
  try {
    if (!getAuthToken()) return null;
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as DemoSession) : null;
  } catch {
    return null;
  }
}
export function saveBackendSession(session: DemoSession, token: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearBackendSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
export function endDemoSession(): void {
  clearBackendSession();
}
export const navigationByRole: Record<Role, string[]> = {
  "Clinic Administrator": [
    "/",
    "/patients",
    "/medical-records",
    "/appointments",
    "/consultations",
    "/prescriptions",
    "/laboratory",
    "/laboratory/results",
    "/pharmacy",
    "/inventory",
    "/suppliers",
    "/procurement",
    "/billing",
    "/reports/financial",
    "/reports/operational",
    "/administration/users",
    "/administration/audit-logs",
    "/administration/settings",
    "/notifications",
    "/profile",
  ],
  Receptionist: [
    "/",
    "/patients",
    "/appointments",
    "/billing",
    "/reports/operational",
    "/notifications",
    "/profile",
  ],
  Doctor: [
    "/",
    "/patients",
    "/medical-records",
    "/appointments",
    "/consultations",
    "/prescriptions",
    "/laboratory",
    "/laboratory/results",
    "/notifications",
    "/profile",
  ],
  Pharmacist: [
    "/",
    "/patients",
    "/prescriptions",
    "/pharmacy",
    "/inventory",
    "/suppliers",
    "/procurement",
    "/notifications",
    "/profile",
  ],
  "Laboratory Technician": [
    "/",
    "/patients",
    "/laboratory",
    "/laboratory/results",
    "/notifications",
    "/profile",
  ],
  Patient: [
    "/",
    "/appointments",
    "/medical-records",
    "/prescriptions",
    "/laboratory/results",
    "/billing",
    "/notifications",
    "/profile",
  ],
};
export const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/patients": "Patients",
  "/patients/new": "Register Patient",
  "/medical-records": "Medical Records",
  "/appointments": "Appointments",
  "/consultations": "Consultations",
  "/prescriptions": "Prescriptions",
  "/laboratory": "Laboratory Worklist",
  "/laboratory/results": "Laboratory Results",
  "/pharmacy": "Pharmacy",
  "/inventory": "Inventory & Medicines",
  "/suppliers": "Suppliers",
  "/procurement": "Procurement",
  "/billing": "Billing",
  "/reports/financial": "Financial Reports",
  "/reports/operational": "Operational Reports",
  "/administration/users": "User Administration",
  "/administration/audit-logs": "Audit Logs",
  "/administration/settings": "System Administration",
  "/notifications": "Notifications",
  "/profile": "Profile",
};
export const isPatientRole = (role: Role) => role === "Patient";
export function notificationVisibleToSession(
  item: NotificationRecord,
  session: DemoSession,
): boolean {
  if (session.role === "Patient")
    return (
      item.role === "Patient" &&
      (item.recipientId === session.userId ||
        (!!session.patientId && item.patientId === session.patientId))
    );
  if (item.role === "All staff") return true;
  return (
    item.role === session.role &&
    (!item.recipientId || item.recipientId === session.userId)
  );
}
