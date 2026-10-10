import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ToastProvider } from "../components/feedback/Toast";
import { AppShell } from "../components/layout/AppShell";
import { PageHeader, Panel } from "../components/ui";
import { LoginPage } from "../features/auth/LoginPage";
import { LoadingState } from "../components/layout/LoadingState";
const DashboardPage = lazy(() =>
  import("../features/dashboard/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const AppointmentsPage = lazy(() =>
  import("../features/clinical/AppointmentWorkflow").then((module) => ({
    default: module.AppointmentsPage,
  })),
);
const ConsultationsPage = lazy(() =>
  import("../features/clinical/ClinicalPages").then((module) => ({
    default: module.ConsultationsPage,
  })),
);
const PrescriptionsPage = lazy(() =>
  import("../features/clinical/ClinicalPages").then((module) => ({
    default: module.PrescriptionsPage,
  })),
);
const PatientsPage = lazy(() =>
  import("../features/patients/PatientPages").then((module) => ({
    default: module.PatientsPage,
  })),
);
const PatientProfilePage = lazy(() =>
  import("../features/patients/PatientPages").then((module) => ({
    default: module.PatientProfilePage,
  })),
);
const RegisterPatientPage = lazy(() =>
  import("../features/patients/PatientPages").then((module) => ({
    default: module.RegisterPatientPage,
  })),
);
const MedicalRecordsPage = lazy(() =>
  import("../features/patients/PatientPages").then((module) => ({
    default: module.MedicalRecordsPage,
  })),
);
const LaboratoryResultsPage = lazy(() =>
  import("../features/laboratory/LaboratoryPages").then((module) => ({
    default: module.LaboratoryResultsPage,
  })),
);
const LaboratoryWorklistPage = lazy(() =>
  import("../features/laboratory/LaboratoryPages").then((module) => ({
    default: module.LaboratoryWorklistPage,
  })),
);
const PharmacyPage = lazy(() =>
  import("../features/pharmacy/PharmacyPage").then((module) => ({
    default: module.PharmacyPage,
  })),
);
const InventoryPage = lazy(() =>
  import("../features/inventory/InventoryPages").then((module) => ({
    default: module.InventoryPage,
  })),
);
const ProcurementPage = lazy(() =>
  import("../features/inventory/InventoryPages").then((module) => ({
    default: module.ProcurementPage,
  })),
);
const SuppliersPage = lazy(() =>
  import("../features/inventory/InventoryPages").then((module) => ({
    default: module.SuppliersPage,
  })),
);
const BillingPage = lazy(() =>
  import("../features/finance/FinancePages").then((module) => ({
    default: module.BillingPage,
  })),
);
const FinancialReportsPage = lazy(() =>
  import("../features/finance/FinancePages").then((module) => ({
    default: module.FinancialReportsPage,
  })),
);
const OperationalReportsPage = lazy(() =>
  import("../features/finance/FinancePages").then((module) => ({
    default: module.OperationalReportsPage,
  })),
);
const AuditLogsPage = lazy(() =>
  import("../features/administration/AdminPages").then((module) => ({
    default: module.AuditLogsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("../features/administration/AdminPages").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../features/administration/AdminPages").then((module) => ({
    default: module.ProfilePage,
  })),
);
const SystemAdministrationPage = lazy(() =>
  import("../features/administration/AdminPages").then((module) => ({
    default: module.SystemAdministrationPage,
  })),
);
const UserAdministrationPage = lazy(() =>
  import("../features/administration/AdminPages").then((module) => ({
    default: module.UserAdministrationPage,
  })),
);
import { canVisitPath } from "../lib/auth/access";
import { endDemoSession, getAuthToken, getSession } from "../lib/auth/session";
import { api } from "../lib/api/api";
import type { DemoSession } from "../lib/api/types";
import { Button } from "../components/ui";

function RouteGuard({
  session,
  path,
  children,
}: {
  session: DemoSession;
  path: string;
  children: ReactNode;
}) {
  const location = useLocation();
  if (!canVisitPath(session.role, path))
    return (
      <>
        <PageHeader
          title="Access not available for this role"
          subtitle="Return to your role-specific workspace or sign in with another clinic account."
        />
        <Panel>
          <div className="empty-state">
            <strong>{session.role}</strong>
            <p>
              Your account role does not have access to this page. Please contact your clinic administrator if you need access.
            </p>
            <Button
              onClick={() => {
                window.location.assign("/");
              }}
            >
              Return to dashboard
            </Button>
          </div>
        </Panel>
      </>
    );
  return <div key={`${path}:${location.pathname}`}>{children}</div>;
}

function CareflowRoutes() {
  const [session, setSession] = useState<DemoSession | null>(() =>
    getSession(),
  );
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    const expired = () => {
      endDemoSession();
      if (live) {
        setSession(null);
        navigate("/login", { replace: true });
      }
    };
    window.addEventListener("careflow:session-expired", expired);
    if (getAuthToken())
      void api
        .getCurrentSession()
        .then((value) => {
          if (!live) return;
          setSession(value);
          void api.getPreferences().catch(() => undefined);
        })
        .catch(expired);
    else setSession(null);
    return () => {
      live = false;
      window.removeEventListener("careflow:session-expired", expired);
    };
  }, [navigate]);
  const login = (value: DemoSession) => {
    setSession(value);
    void api.getPreferences().catch(() => undefined);
    navigate("/", { replace: true });
  };
  const logout = () => {
    void api.logout().catch(() => undefined);
    endDemoSession();
    setSession(null);
    navigate("/login", { replace: true });
  };
  const protectedPage = (path: string, element: ReactNode) =>
    session ? (
      <RouteGuard session={session} path={path}>
        {element}
      </RouteGuard>
    ) : (
      <Navigate to="/login" replace />
    );
  return (
    <Suspense fallback={<LoadingState label="Loading Careflow workspace…" />}>
      <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <Navigate to="/" replace />
            ) : (
              <LoginPage onLogin={login} />
            )
          }
        />
        <Route
          element={
            session ? (
              <AppShell session={session} onLogout={logout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route
            path="/"
            element={protectedPage(
              "/",
              <DashboardPage
                role={session?.role ?? "Receptionist"}
                patientId={session?.patientId}
                userId={session?.userId}
              />,
            )}
          />
          <Route
            path="/patients"
            element={protectedPage("/patients", <PatientsPage />)}
          />
          <Route
            path="/patients/new"
            element={protectedPage("/patients", <RegisterPatientPage />)}
          />
          <Route
            path="/patients/:id"
            element={protectedPage(
              "/patients",
              <PatientProfilePage role={session?.role ?? "Receptionist"} />,
            )}
          />
          <Route
            path="/medical-records"
            element={protectedPage(
              "/medical-records",
              <MedicalRecordsPage
                role={session?.role ?? "Receptionist"}
                patientId={session?.patientId}
              />,
            )}
          />
          <Route
            path="/appointments"
            element={protectedPage(
              "/appointments",
              <AppointmentsPage
                session={
                  session ?? { userId: "", name: "", role: "Receptionist" }
                }
              />,
            )}
          />
          <Route
            path="/consultations"
            element={protectedPage(
              "/consultations",
              <ConsultationsPage
                role={session?.role ?? "Receptionist"}
                providerName={session?.name ?? "Dr. Omar Hassan"}
              />,
            )}
          />
          <Route
            path="/prescriptions"
            element={protectedPage(
              "/prescriptions",
              <PrescriptionsPage
                role={session?.role ?? "Receptionist"}
                patientId={session?.patientId}
                providerName={session?.name ?? "Dr. Omar Hassan"}
              />,
            )}
          />
          <Route
            path="/laboratory"
            element={protectedPage(
              "/laboratory",
              <LaboratoryWorklistPage role={session?.role ?? "Receptionist"} />,
            )}
          />
          <Route
            path="/laboratory/results"
            element={protectedPage(
              "/laboratory/results",
              <LaboratoryResultsPage
                role={session?.role ?? "Receptionist"}
                patientId={session?.patientId}
              />,
            )}
          />
          <Route
            path="/pharmacy"
            element={protectedPage("/pharmacy", <PharmacyPage />)}
          />
          <Route
            path="/inventory"
            element={protectedPage("/inventory", <InventoryPage />)}
          />
          <Route
            path="/suppliers"
            element={protectedPage("/suppliers", <SuppliersPage />)}
          />
          <Route
            path="/procurement"
            element={protectedPage("/procurement", <ProcurementPage />)}
          />
          <Route
            path="/billing"
            element={protectedPage(
              "/billing",
              <BillingPage
                role={session?.role ?? "Receptionist"}
                patientId={session?.patientId}
              />,
            )}
          />
          <Route
            path="/reports/financial"
            element={protectedPage(
              "/reports/financial",
              <FinancialReportsPage />,
            )}
          />
          <Route
            path="/reports/operational"
            element={protectedPage(
              "/reports/operational",
              <OperationalReportsPage />,
            )}
          />
          <Route
            path="/administration/users"
            element={protectedPage(
              "/administration/users",
              <UserAdministrationPage />,
            )}
          />
          <Route
            path="/administration/audit-logs"
            element={protectedPage(
              "/administration/audit-logs",
              <AuditLogsPage />,
            )}
          />
          <Route
            path="/administration/settings"
            element={protectedPage(
              "/administration/settings",
              <SystemAdministrationPage />,
            )}
          />
          <Route
            path="/notifications"
            element={protectedPage(
              "/notifications",
              <NotificationsPage
                session={
                  session ?? { userId: "", name: "", role: "Receptionist" }
                }
              />,
            )}
          />
          <Route
            path="/profile"
            element={protectedPage(
              "/profile",
              <ProfilePage
                session={
                  session ?? { userId: "", name: "", role: "Receptionist" }
                }
                onLogout={logout}
              />,
            )}
          />
        </Route>
        <Route
          path="*"
          element={<Navigate to={session ? "/" : "/login"} replace />}
        />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <CareflowRoutes />
    </ToastProvider>
  );
}
