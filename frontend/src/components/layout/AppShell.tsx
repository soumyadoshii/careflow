import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Pill,
  Receipt,
  ScrollText,
  Search,
  Settings,
  Stethoscope,
  Truck,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { DemoSession } from "../../lib/api/types";
import { api } from "../../lib/api/api";
import {
  navigationByRole,
  notificationVisibleToSession,
} from "../../lib/auth/session";

const iconMap: Record<string, React.ComponentType<{ size?: number }>> = {
  "/": LayoutDashboard,
  "/patients": Users,
  "/medical-records": FileText,
  "/appointments": CalendarDays,
  "/consultations": Stethoscope,
  "/prescriptions": ClipboardList,
  "/laboratory": FlaskConical,
  "/laboratory/results": FileText,
  "/pharmacy": Pill,
  "/inventory": Package,
  "/suppliers": Truck,
  "/procurement": ClipboardList,
  "/billing": Receipt,
  "/reports/financial": BarChart3,
  "/reports/operational": Activity,
  "/administration/users": UserCog,
  "/administration/audit-logs": ScrollText,
  "/administration/settings": Settings,
  "/notifications": Bell,
  "/profile": UserRound,
};

const navGroups = [
  { label: "Workspace", items: [{ path: "/", label: "Dashboard" }] },
  {
    label: "Clinical",
    items: [
      { path: "/patients", label: "Patients" },
      { path: "/medical-records", label: "Medical Records" },
      { path: "/appointments", label: "Appointments" },
      { path: "/consultations", label: "Consultations" },
      { path: "/prescriptions", label: "Prescriptions" },
      { path: "/laboratory", label: "Laboratory Worklist" },
      { path: "/laboratory/results", label: "Laboratory Results" },
    ],
  },
  {
    label: "Pharmacy & Inventory",
    items: [
      { path: "/pharmacy", label: "Pharmacy" },
      { path: "/inventory", label: "Inventory & Medicines" },
      { path: "/suppliers", label: "Suppliers" },
      { path: "/procurement", label: "Procurement" },
    ],
  },
  {
    label: "Finance & Reports",
    items: [
      { path: "/billing", label: "Billing" },
      { path: "/reports/financial", label: "Financial Reports" },
      { path: "/reports/operational", label: "Operational Reports" },
    ],
  },
  {
    label: "Administration",
    items: [
      { path: "/administration/users", label: "User Administration" },
      { path: "/administration/audit-logs", label: "Audit Logs" },
      { path: "/administration/settings", label: "System Administration" },
    ],
  },
  {
    label: "Account",
    items: [
      { path: "/notifications", label: "Notifications" },
      { path: "/profile", label: "Profile" },
    ],
  },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.replace(/[^A-Za-z]/g, "").slice(0, 1))
    .join("")
    .toUpperCase();

export function AppShell({
  session,
  onLogout,
}: {
  session: DemoSession;
  onLogout: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [unread, setUnread] = useState(0);
  const permitted = useMemo(
    () => new Set(navigationByRole[session.role]),
    [session.role],
  );

  useEffect(() => {
    let live = true;
    const refreshUnread = () => {
      void api.list("notifications").then((items) => {
        if (live)
          setUnread(
            items.filter(
              (item) =>
                !item.read && notificationVisibleToSession(item, session),
            ).length,
          );
      });
    };
    refreshUnread();
    window.addEventListener("careflow:notifications-updated", refreshUnread);
    return () => {
      live = false;
      window.removeEventListener(
        "careflow:notifications-updated",
        refreshUnread,
      );
    };
  }, [session.role, session.userId, session.patientId, location.pathname]);

  const goSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    if (session.role === "Patient")
      navigate(`/appointments?search=${encodeURIComponent(term)}`);
    else navigate(`/patients?search=${encodeURIComponent(term)}`);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <div
        className={`mobile-scrim ${mobileOpen ? "active" : ""}`}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-plus">+</span>
          </div>
          <div>
            <span className="brand-name">Careflow</span>
            <span className="brand-caption">Clinic ERP</span>
          </div>
        </div>
        <div className="nav-scroll">
          {navGroups.map((group) => {
            const items = group.items.filter((item) =>
              permitted.has(item.path),
            );
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-label">{group.label}</div>
                {items.map((item) => {
                  const Icon = iconMap[item.path] ?? FileText;
                  const isActive =
                    item.path === "/"
                      ? location.pathname === "/"
                      : location.pathname === item.path ||
                        (item.path === "/patients" &&
                          location.pathname.startsWith("/patients/"));
                  return (
                    <NavLink
                      to={item.path}
                      key={item.path}
                      className={`nav-link ${isActive ? "active" : ""}`}
                      onClick={() => setMobileOpen(false)}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                      {item.path === "/notifications" && unread > 0 && (
                        <span className="nav-count">{unread}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="nav-footer">
          <div className="nav-demo">
            <Activity size={12} /> Careflow Clinic ERP
          </div>
          <div className="nav-user">
            <div className="avatar navy">{initials(session.name)}</div>
            <div className="nav-user-copy">
              <strong>{session.name}</strong>
              <span>{session.role}</span>
            </div>
            <button
              className="nav-logout"
              aria-label="Sign out"
              title="Sign out"
              onClick={onLogout}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="top-icon mobile-menu"
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="top-context">Careflow Clinic · Operations</span>
          </div>
          <div className="topbar-right">
            <form className="global-search" onSubmit={goSearch}>
              <Search size={15} />
              <input
                aria-label="Search the workspace"
                placeholder={
                  session.role === "Patient"
                    ? "Search appointments…"
                    : "Search patients, visits…"
                }
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </form>
            <button
              className="top-icon"
              aria-label="Open notifications"
              title="Notifications"
              onClick={() => navigate("/notifications")}
            >
              <Bell size={18} />
              {unread > 0 && <span className="unread-dot" />}
            </button>
            <span className="role-chip">Role: {session.role}</span>
            <button
              className="top-icon profile-top"
              aria-label="Open profile"
              title="Profile"
              onClick={() => navigate("/profile")}
            >
              <span className="avatar">{initials(session.name)}</span>
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
