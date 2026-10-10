import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Check,
  LogOut,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../../lib/api/api";
import type { DemoPreferences } from "../../lib/api/api";
import type {
  AuditEvent,
  DemoSession,
  NotificationRecord,
  Patient,
  Role,
  SystemSetting,
  UserAccount,
} from "../../lib/api/types";
import { CAREFLOW_ROLES } from "../../lib/api/types";
import { formatDate } from "../../lib/format";
import { notificationVisibleToSession } from "../../lib/auth/session";
import { useToast } from "../../components/feedback/Toast";
import { CrudPage } from "../../components/data/CrudPage";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import { Button, PageHeader, Panel, StatusBadge } from "../../components/ui";
import type { EntityField } from "../../components/forms/EntityFormDialog";

export function UserAdministrationPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  useEffect(() => {
    void api
      .list("patients")
      .then(setPatients)
      .catch(() => setPatients([]));
  }, []);
  const columns: TableColumn<never>[] = [
    { key: "name", label: "User" },
    { key: "email", label: "Email" },
    { key: "role", label: "System role" },
    { key: "department", label: "Department" },
    { key: "lastActive", label: "Last active" },
    { key: "status", label: "Status" },
  ];
  const fields: EntityField[] = [
    { name: "name", label: "Full name", required: true },
    {
      name: "email",
      label: "Work email",
      type: "email" as const,
      required: true,
    },
    {
      name: "role",
      label: "System role",
      type: "select" as const,
      required: true,
      options: CAREFLOW_ROLES.map((value) => ({ value, label: value })),
    },
    { name: "department", label: "Department", required: true },
    {
      name: "status",
      label: "Account status",
      type: "select" as const,
      required: true,
      options: ["Active", "Inactive"].map((value) => ({ value, label: value })),
    },
  ];
  const createFields: EntityField[] = [
    ...fields,
    {
      name: "patientId",
      label: "Patient record (Patient accounts only)",
      type: "select",
      options: patients.map((p) => ({
        value: p.id,
        label: `${p.name} · ${p.mrn}`,
      })),
    },
    {
      name: "password",
      label: "Initial password",
      type: "password",
      required: true,
      hint: "10–128 characters; share securely with the account holder.",
    },
  ];
  return (
    <>
      <div className="callout">
        <ShieldCheck size={16} />
        <div>
          <strong>Role-based access.</strong> Access is limited according to each account’s assigned role. Provide an initial password securely; it is never shown after account creation.
        </div>
      </div>
      <div className="section-gap">
        <CrudPage
          collection="users"
          title="User Administration"
          description="Manage clinic staff and the six Careflow role types."
          columns={columns as never}
          fields={fields}
          createFields={createFields}
          createLabel="Add user"
        />
      </div>
    </>
  );
}

export function AuditLogsPage() {
  const columns: TableColumn<AuditEvent>[] = [
    { key: "at", label: "Timestamp" },
    { key: "actor", label: "Actor" },
    { key: "role", label: "Role" },
    { key: "action", label: "Action" },
    { key: "area", label: "Area" },
    { key: "recordId", label: "Record ID" },
    { key: "details", label: "Details" },
  ];
  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Searchable audit history for clinic operations."
      />
      <div className="callout">
        <ShieldCheck size={16} />
        <div>
          Audit events are recorded and cannot be edited or deleted through ordinary application actions.
        </div>
      </div>
      <AuditLogTable columns={columns} />
    </>
  );
}

interface AuditRow extends AuditEvent {
  date: string;
  time: string;
}
function AuditLogTable({ columns }: { columns: TableColumn<AuditEvent>[] }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const reload = useCallback(() => {
    void api.list("audit").then((events) =>
      setRows(
        events.map((event) => ({
          ...event,
          date: event.at.slice(0, 10),
          time: event.at.slice(11, 16),
        })),
      ),
    );
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return (
    <div className="section-gap">
      <Panel
        title="Recent audit events"
        subtitle={`${rows.length} persisted audit events`}
      >
        <DataTable
          rows={rows}
          columns={columns}
          filters={[
            { key: "actor", label: "Actor" },
            { key: "date", label: "Event date" },
            { key: "time", label: "Event time" },
            { key: "area", label: "Area" },
            { key: "action", label: "Action" },
          ]}
          searchPlaceholder="Search actor, action, area, record…"
        />
      </Panel>
    </div>
  );
}

export function SystemAdministrationPage() {
  const columns: TableColumn<never>[] = [
    { key: "label", label: "Setting" },
    { key: "value", label: "Current value" },
    { key: "description", label: "Purpose" },
  ];
  const fields = [
    { name: "label", label: "Setting name", required: true },
    { name: "value", label: "Value", required: true },
    {
      name: "description",
      label: "Description",
      type: "textarea" as const,
      required: true,
    },
  ];
  return (
    <>
      <div className="callout">
        <Settings size={16} />
        <div>
          <strong>Clinic settings.</strong> Changes are saved with clinic records.
        </div>
      </div>
      <div className="section-gap">
        <CrudPage
          collection="settings"
          title="System Administration"
          description="Adjust Careflow clinic settings and operational preferences."
          columns={columns as never}
          fields={fields}
          createLabel="Add preference"
          allowArchive={false}
        />
      </div>
    </>
  );
}

export function NotificationsPage({ session }: { session: DemoSession }) {
  const [rows, setRows] = useState<NotificationRecord[]>([]);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const items = await api.list("notifications");
    setRows(
      items.filter((item) => notificationVisibleToSession(item, session)),
    );
  }, [session.role, session.userId, session.patientId]);
  useEffect(() => {
    void reload();
    const refresh = () => {
      void reload();
    };
    window.addEventListener("careflow:notifications-updated", refresh);
    return () =>
      window.removeEventListener("careflow:notifications-updated", refresh);
  }, [reload]);
  const displayRows = rows.map((item) => ({
    ...item,
    status: item.read ? "Read" : "Unread",
  }));
  const columns: TableColumn<(typeof displayRows)[number]>[] = [
    {
      key: "title",
      label: "Notification",
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          <div className="activity-kicker">{row.message}</div>
        </div>
      ),
    },
    { key: "at", label: "Received", render: (row) => row.at },
    { key: "status", label: "Status" },
    {
      key: "href",
      label: "Related area",
      render: (row) => (
        <Link className="link-button" to={row.href}>
          Open
        </Link>
      ),
    },
  ];
  const markRead = async (row: (typeof displayRows)[number]) => {
    await api.markNotificationRead(row.id);
    await reload();
    showToast("Notification marked as read.");
  };
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Role-relevant reminders and operational alerts."
      />
      <Panel
        title="Inbox"
        subtitle={`${displayRows.filter((item) => !item.read).length} unread notifications`}
      >
        <DataTable
          rows={displayRows}
          columns={columns}
          searchPlaceholder="Search notification title or message…"
          rowActions={(row) =>
            !row.read ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void markRead(row);
                }}
              >
                <Check size={13} />
                Mark read
              </Button>
            ) : (
              <span className="activity-kicker">Read</span>
            )
          }
        />
      </Panel>
    </>
  );
}

export function ProfilePage({
  session,
  onLogout,
}: {
  session: DemoSession;
  onLogout: () => void;
}) {
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<DemoPreferences | null>(null);
  useEffect(() => {
    void api
      .getPreferences()
      .then((value) => {
        setPreferences(value);
        document.documentElement.dataset.tableDensity = value.compactTables
          ? "compact"
          : "comfortable";
      })
      .catch(() => {
        showToast(
          "Unable to load profile preferences; your authenticated session remains active.",
          "error",
        );
      });
  }, []);
  const savePreferences = async (patch: Partial<DemoPreferences>) => {
    try {
      const next = await api.updatePreferences(patch);
      setPreferences(next);
      document.documentElement.dataset.tableDensity = next.compactTables
        ? "compact"
        : "comfortable";
      showToast("Profile preference saved.");
    } catch {
      showToast("Unable to save the profile preference.", "error");
    }
  };
  const reset = async () => {
    if (
      !window.confirm(
        "Reset clinic records and sign out? All current clinic changes will be cleared.",
      )
    )
      return;
    try {
      await api.reset();
      showToast("Clinic records restored. Returning to sign in.");
      onLogout();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to reset clinic records.",
        "error",
      );
    }
  };
  const initials = session.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Authenticated account and display preferences."
      />
      <div className="content-grid two">
        <Panel
          title="Current account"
          subtitle="Account and role details"
        >
          <div className="setting-row">
            <div className="profile-head">
              <div className="avatar">{initials}</div>
              <div>
                <strong>{session.name}</strong>
                <span>{session.role}</span>
              </div>
            </div>
            <span className="role-chip">Signed in</span>
          </div>
          <div className="detail-grid">
            <div className="detail-item">
              <span>Account ID</span>
              <strong>{session.userId}</strong>
            </div>
            <div className="detail-item">
              <span>System role</span>
              <strong>{session.role}</strong>
            </div>
            <div className="detail-item">
              <span>Patient link</span>
              <strong>{session.patientId ?? "Not applicable"}</strong>
            </div>
          </div>
          <div className="profile-actions">
            <Button variant="secondary" onClick={onLogout}>
              <LogOut size={15} />
              Sign out
            </Button>
            {session.role === "Clinic Administrator" && (
              <Button
                variant="danger"
                onClick={() => {
                  void reset();
                }}
              >
                <RotateCcw size={15} />
                Reset clinic records
              </Button>
            )}
          </div>
        </Panel>
        <Panel
          title="Account & preferences"
          subtitle="Authenticated identity and saved display settings"
        >
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Account security</strong>
              <span>
                Access to clinic records is limited according to your assigned role.
              </span>
            </div>
            <StatusBadge value="Active" />
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Date format</strong>
              <span>
                Applied to displayed clinic dates throughout the workspace.
              </span>
            </div>
            <select
              className="preference-select"
              aria-label="Date format"
              value={preferences?.dateFormat ?? "MMM D, YYYY"}
              onChange={(event) => {
                void savePreferences({
                  dateFormat: event.target
                    .value as DemoPreferences["dateFormat"],
                });
              }}
            >
              <option value="MMM D, YYYY">Oct 2, 2026</option>
              <option value="DD/MM/YYYY">02/10/2026</option>
              <option value="YYYY-MM-DD">2026-10-02</option>
            </select>
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Compact table density</strong>
              <span>Reduce row height for data-dense register review.</span>
            </div>
            <label className="preference-check">
              <input
                type="checkbox"
                checked={preferences?.compactTables ?? false}
                onChange={(event) => {
                  void savePreferences({ compactTables: event.target.checked });
                }}
              />
              <span>Use compact rows</span>
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Clinic data</strong>
              <span>
                Clinic records and preferences are saved for use across sessions.
              </span>
            </div>
            <StatusBadge value="Available" />
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Patient information</strong>
              <span>
                Use this workspace for patient records permitted by your role.
              </span>
            </div>
            <StatusBadge value="Role-based" />
          </div>
        </Panel>
      </div>
    </>
  );
}
