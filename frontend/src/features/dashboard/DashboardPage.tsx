import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Package,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Appointment, Role } from "../../lib/api/types";
import { api, type AppointmentDashboardSummary } from "../../lib/api/api";
import type { ClinicDataSnapshot } from "../../lib/api/storeTypes";
import {
  formatDate,
  formatMoney,
  moneyToPaise,
  paiseToRupees,
  sumPaise,
} from "../../lib/format";
import {
  Button,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from "../../components/ui";

const confirmedStatuses = ["Scheduled", "Checked In", "In Consultation"];
const pendingStatuses = ["Pending Approval", "Reschedule Requested"];
const terminalStatuses = ["Completed", "Cancelled", "Rejected", "No Show"];

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function patientName(data: ClinicDataSnapshot, id: string): string {
  return (
    data.patients.find((patient) => patient.id === id)?.name ?? "Patient record"
  );
}

function slotFor(
  appointment: Appointment,
  mode: "requested" | "confirmed",
): { date: string; time: string } {
  if (mode === "requested") {
    if (
      appointment.proposalById &&
      appointment.proposedDate &&
      appointment.proposedTime
    )
      return { date: appointment.proposedDate, time: appointment.proposedTime };
    if (pendingStatuses.includes(appointment.status))
      return {
        date: appointment.requestedDate,
        time: appointment.requestedTime,
      };
  }
  return {
    date: appointment.confirmedDate ?? appointment.date,
    time: appointment.confirmedTime ?? appointment.time,
  };
}

function AppointmentTable({
  rows,
  data,
  mode,
  showPatient = true,
  showDoctor = true,
  emptyMessage,
}: {
  rows: Appointment[];
  data: ClinicDataSnapshot;
  mode: "requested" | "confirmed";
  showPatient?: boolean;
  showDoctor?: boolean;
  emptyMessage: string;
}) {
  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            {showPatient && <th>Patient</th>}
            {showDoctor && <th>Doctor</th>}
            <th>Department</th>
            <th>Visit type</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((appointment) => {
            const slot = slotFor(appointment, mode);
            const status =
              appointment.cancellationRequestedAt &&
              !terminalStatuses.includes(appointment.status)
                ? "Cancellation Requested"
                : appointment.status;
            return (
              <tr key={appointment.id}>
                <td>{formatDate(slot.date)}</td>
                <td>{slot.time}</td>
                {showPatient && (
                  <td>{patientName(data, appointment.patientId)}</td>
                )}
                {showDoctor && <td>{appointment.provider}</td>}
                <td>{appointment.department}</td>
                <td>{appointment.type}</td>
                <td>
                  <StatusBadge value={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AvailabilityTable({
  data,
  today,
}: {
  data: ClinicDataSnapshot;
  today: string;
}) {
  const blocks = data.availabilityBlocks.filter(
    (item) => item.active && item.date === today,
  );
  if (!blocks.length)
    return (
      <div className="empty-state">
        No unavailable-time blocks are recorded for today.
      </div>
    );
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Unavailable</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => {
            const name =
              block.targetType === "Doctor"
                ? (data.users.find((item) => item.id === block.targetId)
                    ?.name ?? "Doctor")
                : patientName(data, block.targetId);
            return (
              <tr key={block.id}>
                <td>{name}</td>
                <td>{block.targetType}</td>
                <td>
                  {block.startTime}–{block.endTime}
                </td>
                <td>{block.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage({
  role,
  patientId,
  userId,
}: {
  role: Role;
  patientId?: string;
  userId?: string;
}) {
  const today = localDateKey(new Date());
  const [data, setData] = useState<ClinicDataSnapshot | null>(null);
  const [appointmentSummary, setAppointmentSummary] =
    useState<AppointmentDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(false);
    void Promise.all([
      api.getDashboardSnapshotForSession(),
      api.getAppointmentDashboardSummary(today),
    ])
      .then(([snapshot, summary]) => {
        if (!live) return;
        setData(snapshot);
        setAppointmentSummary(summary);
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, [role, patientId, userId, today, retryKey]);

  const chartData = useMemo(() => {
    if (!data) return { days: [], revenue: [] };
    const current = new Date();
    const offsetFromMonday = (current.getDay() + 6) % 7;
    const monday = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() - offsetFromMonday,
      12,
    );
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const key = localDateKey(date);
      const visits = data.appointments.filter(
        (item) =>
          (confirmedStatuses.includes(item.status) ||
            (item.status === "Reschedule Requested" &&
              Boolean(item.confirmedDate))) &&
          (item.confirmedDate ?? item.date) === key,
      ).length;
      return {
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        visits,
      };
    });
    const revenue = Array.from({ length: 6 }, (_, index) => {
      const monthDate = new Date(
        current.getFullYear(),
        current.getMonth() - 5 + index,
        1,
        12,
      );
      const monthKey = localDateKey(monthDate).slice(0, 7);
      const paidPaise = sumPaise(
        data.invoices
          .filter((invoice) => invoice.issuedAt.startsWith(monthKey))
          .map((invoice) => moneyToPaise(invoice.paid)),
      );
      return {
        month: monthDate.toLocaleDateString("en-US", { month: "short" }),
        amount: paiseToRupees(paidPaise),
      };
    });
    return { days, revenue };
  }, [data, today]);

  if (!data)
    return (
      <>
        <PageHeader
          title={role === "Patient" ? "Patient dashboard" : "Clinic dashboard"}
          subtitle={
            loadError
              ? "Dashboard data could not be loaded."
              : "Loading your Careflow workspace…"
          }
        />
        <div className="panel loading-panel">
          {loadError ? (
            <>
              <p role="alert">
                Unable to load the latest information. Your session remains active.
              </p>
              <Button onClick={() => setRetryKey((key) => key + 1)}>
                Retry
              </Button>
            </>
          ) : (
            "Loading clinic data…"
          )}
        </div>
      </>
    );

  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const ownId = patientId ?? "";

  if (role === "Patient" && !ownId)
    return (
      <>
        <PageHeader
          title="Patient dashboard"
          subtitle="No patient account is linked to this session."
        />
        <Panel>
          <p role="alert">
            Contact the clinic administrator to link your authenticated account
            to a patient record.
          </p>
        </Panel>
      </>
    );

  if (role === "Patient") {
    const ownAppointments = data.appointments.filter(
      (item) => item.patientId === ownId,
    );
    const pending = ownAppointments
      .filter(
        (item) =>
          pendingStatuses.includes(item.status) &&
          !item.cancellationRequestedAt,
      )
      .sort((a, b) =>
        `${a.requestedDate}${a.requestedTime}`.localeCompare(
          `${b.requestedDate}${b.requestedTime}`,
        ),
      );
    const confirmed = ownAppointments
      .filter(
        (item) =>
          confirmedStatuses.includes(item.status) ||
          (item.status === "Reschedule Requested" &&
            Boolean(item.confirmedDate)),
      )
      .sort((a, b) =>
        `${a.confirmedDate ?? a.date}${a.confirmedTime ?? a.time}`.localeCompare(
          `${b.confirmedDate ?? b.date}${b.confirmedTime ?? b.time}`,
        ),
      );
    const upcomingPending = pending.filter(
      (item) => slotFor(item, "requested").date >= today,
    );
    const upcomingConfirmed = confirmed.filter(
      (item) => slotFor(item, "confirmed").date >= today,
    );
    const ownPrescriptions = data.prescriptions.filter(
      (item) =>
        item.patientId === ownId &&
        !["Dispensed", "Cancelled"].includes(item.status),
    );
    const ownInvoices = data.invoices.filter(
      (item) => item.patientId === ownId,
    );
    const ownBalance = paiseToRupees(
      sumPaise(
        ownInvoices.map(
          (item) => moneyToPaise(item.total) - moneyToPaise(item.paid),
        ),
      ),
    );
    return (
      <>
        <PageHeader
          eyebrow="Patient portal"
          title="Your care dashboard"
          subtitle="Your appointment requests and confirmed visits, in one place."
          actions={
            <Link to="/appointments">
              <Button variant="primary">
                <CalendarDays size={15} />
                View appointments
              </Button>
            </Link>
          }
        />
        <div className="callout">
          <Activity size={16} />
          <div>
            <strong>Private patient view.</strong> This account only sees its linked records. Access to patient information is limited by the assigned role.
          </div>
        </div>
        <div className="metric-grid section-gap">
          <Metric
            label="Upcoming appointments"
            value={upcomingPending.length + upcomingConfirmed.length}
            detail="Pending requests and confirmed visits"
            icon={<CalendarDays size={16} />}
          />
          <Metric
            label="Open prescriptions"
            value={ownPrescriptions.length}
            detail="Pending or ready for pickup"
            icon={<ClipboardList size={16} />}
          />
          <Metric
            label="Account balance"
            value={formatMoney(ownBalance)}
            detail="Outstanding invoice balance"
            icon={<CircleDollarSign size={16} />}
          />
          <Metric
            label="Patient record"
            value={
              data.patients.find((item) => item.id === ownId)?.mrn ??
              "Patient record"
            }
            detail="Linked patient profile"
            icon={<Users size={16} />}
          />
        </div>
        <div className="content-grid two section-gap">
          <Panel
            title="Upcoming Appointment Requests"
            subtitle="Requests awaiting receptionist review. They are not confirmed bookings."
          >
            <AppointmentTable
              rows={upcomingPending}
              data={data}
              mode="requested"
              showPatient={false}
              emptyMessage="No upcoming appointment requests."
            />
          </Panel>
          <Panel
            title="Confirmed Appointments"
            subtitle="Visits scheduled by the Receptionist. A pending time change does not replace the confirmed slot until approved."
          >
            <AppointmentTable
              rows={upcomingConfirmed}
              data={data}
              mode="confirmed"
              showPatient={false}
              emptyMessage="No upcoming confirmed appointments."
            />
          </Panel>
        </div>
      </>
    );
  }

  if (role === "Doctor") {
    const myAppointments = data.appointments.filter(
      (item) => item.doctorId === userId,
    );
    const myRequests = myAppointments
      .filter(
        (item) =>
          (pendingStatuses.includes(item.status) && !item.proposalById) ||
          (Boolean(item.cancellationRequestedAt) &&
            !terminalStatuses.includes(item.status)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const todayAppointments = (
      appointmentSummary?.todayAppointments ?? []
    ).filter((item) => item.doctorId === userId);
    const upcoming = myAppointments
      .filter(
        (item) =>
          (confirmedStatuses.includes(item.status) ||
            (item.status === "Reschedule Requested" &&
              Boolean(item.confirmedDate))) &&
          slotFor(item, "confirmed").date > today,
      )
      .sort((a, b) =>
        `${a.confirmedDate ?? a.date}${a.confirmedTime ?? a.time}`.localeCompare(
          `${b.confirmedDate ?? b.date}${b.confirmedTime ?? b.time}`,
        ),
      );
    return (
      <>
        <PageHeader
          eyebrow={`Doctor workspace · ${dateLabel}`}
          title="My clinical schedule"
          subtitle="Appointment requests, today’s confirmed schedule, and upcoming visits."
          actions={
            <Link to="/appointments">
              <Button variant="primary">
                <CalendarDays size={15} />
                Open appointments
              </Button>
            </Link>
          }
        />
        <div className="metric-grid section-gap">
          <Metric
            label="Appointment requests"
            value={myRequests.length}
            detail="Awaiting receptionist review or response"
            icon={<CalendarDays size={16} />}
          />
          <Metric
            label="Today's schedule"
            value={todayAppointments.length}
            detail="Confirmed visits for today"
            icon={<Check size={16} />}
          />
          <Metric
            label="Upcoming appointments"
            value={upcoming.length}
            detail="Future confirmed visits"
            icon={<Clock3 size={16} />}
          />
          <Metric
            label="Availability flags"
            value={appointmentSummary?.todayBlocksCount ?? 0}
            detail="Your recorded unavailable periods today"
            icon={<AlertTriangle size={16} />}
          />
        </div>
        <div className="content-grid two section-gap">
          <Panel
            title="Appointment Requests / Relevant Appointments"
            subtitle="Requests assigned to you; the Receptionist makes final scheduling decisions."
          >
            <AppointmentTable
              rows={myRequests}
              data={data}
              mode="requested"
              showDoctor={false}
              emptyMessage="No appointment requests need your attention."
            />
          </Panel>
          <Panel
            title="Today's Schedule"
            subtitle={`${todayAppointments.length} confirmed visit${todayAppointments.length === 1 ? "" : "s"} · ${dateLabel}`}
          >
            <AppointmentTable
              rows={todayAppointments}
              data={data}
              mode="confirmed"
              showDoctor={false}
              emptyMessage="No confirmed appointments are scheduled for today."
            />
          </Panel>
        </div>
        <Panel
          title="Upcoming Appointments"
          subtitle="Future confirmed appointments assigned to your Doctor identity."
          className="section-gap"
        >
          <AppointmentTable
            rows={upcoming}
            data={data}
            mode="confirmed"
            showDoctor={false}
            emptyMessage="No future confirmed appointments are scheduled."
          />
        </Panel>
      </>
    );
  }

  if (role === "Receptionist") {
    const pendingRequests = appointmentSummary?.pendingRequests ?? [];
    const todayAppointments = appointmentSummary?.todayAppointments ?? [];
    return (
      <>
        <PageHeader
          eyebrow={`Reception workspace · ${dateLabel}`}
          title="Appointment operations"
          subtitle="Review requests, verify both schedules, and manage today’s confirmed appointments."
          actions={
            <Link to="/appointments">
              <Button variant="primary">
                <CalendarDays size={15} />
                Open appointment queue
              </Button>
            </Link>
          }
        />
        <div className="metric-grid section-gap">
          <Metric
            label="Pending Approval"
            value={appointmentSummary?.pendingCount ?? 0}
            detail="Appointment requests awaiting a scheduling decision"
            icon={<CalendarDays size={16} />}
          />
          <Metric
            label="Today's confirmed appointments"
            value={appointmentSummary?.todayConfirmedCount ?? 0}
            detail="Scheduled, checked in, or in consultation"
            icon={<Check size={16} />}
          />
          <Metric
            label="Today's availability conflicts"
            value={appointmentSummary?.conflictingRequestsCount ?? 0}
            detail="Patient or Doctor conflict needs review"
            icon={<AlertTriangle size={16} />}
          />
          <Metric
            label="Unavailable blocks today"
            value={appointmentSummary?.todayBlocksCount ?? 0}
            detail="Patient and Doctor blocks are included"
            icon={<Clock3 size={16} />}
          />
        </div>
        <div className="content-grid two section-gap">
          <Panel
            title="Appointment Requests"
            subtitle={`${pendingRequests.length} request or cancellation item${pendingRequests.length === 1 ? "" : "s"} waiting in the review queue.`}
            actions={
              <Link className="link-button" to="/appointments">
                Review queue <ArrowRight size={12} />
              </Link>
            }
          >
            <AppointmentTable
              rows={pendingRequests.slice(0, 6)}
              data={data}
              mode="requested"
              emptyMessage="No appointment requests or cancellation actions need review."
            />
          </Panel>
          <Panel
            title="Today's doctor availability and conflicts"
            subtitle={`${appointmentSummary?.conflictingRequestsCount ?? 0} pending request${appointmentSummary?.conflictingRequestsCount === 1 ? "" : "s"} currently conflict with a patient or Doctor slot.`}
          >
            <AvailabilityTable data={data} today={today} />
          </Panel>
        </div>
        <Panel
          title="Today's confirmed appointments"
          subtitle={`${todayAppointments.length} visit${todayAppointments.length === 1 ? "" : "s"} · ${dateLabel}`}
          className="section-gap"
          actions={
            <Link className="link-button" to="/appointments">
              Open schedule <ArrowRight size={12} />
            </Link>
          }
        >
          <AppointmentTable
            rows={todayAppointments}
            data={data}
            mode="confirmed"
            emptyMessage="No confirmed appointments are scheduled for today."
          />
        </Panel>
      </>
    );
  }

  const activePatients = data.patients.filter(
    (item) => item.status === "Active",
  ).length;
  const appointmentsToday = appointmentSummary?.todayConfirmedCount ?? 0;
  const pendingLabs = data.labOrders.filter(
    (item) => !["Completed", "Reviewed"].includes(item.status),
  ).length;
  const lowStock = data.medicines.filter(
    (item) =>
      item.active && (item.stock === 0 || item.stock <= item.minimumStock),
  ).length;
  const todayAppointments = appointmentSummary?.todayAppointments ?? [];
  const recent = data.audit.slice(0, 4);

  return (
    <>
      <PageHeader
        eyebrow={`Clinic operations · ${dateLabel}`}
        title="Clinic dashboard"
        subtitle="A clear operational view of today’s clinic activity."
        actions={
          <Link to="/appointments">
            <Button variant="secondary">
              <CalendarDays size={15} />
              Open schedule
            </Button>
          </Link>
        }
      />
      <div className="metric-grid">
        <Metric
          label="Active patients"
          value={activePatients.toLocaleString()}
          detail="Registered clinic records"
          trend="up"
          icon={<Users size={16} />}
        />
        <Metric
          label="Appointments today"
          value={appointmentsToday}
          detail="Confirmed clinical appointments"
          trend="steady"
          icon={<CalendarDays size={16} />}
        />
        <Metric
          label="Laboratory queue"
          value={pendingLabs}
          detail="Orders requiring attention"
          trend="steady"
          icon={<ClipboardList size={16} />}
        />
        <Metric
          label="Low-stock medicines"
          value={lowStock}
          detail="At or below minimum level"
          trend="down"
          icon={<Package size={16} />}
        />
      </div>
      <div className="dashboard-top">
        <Panel
          title="Appointments by day"
          subtitle="Confirmed visits · current week"
          className="chart-panel"
        >
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData.days}
                margin={{ top: 5, right: 12, left: -18, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#e6ebf1"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#718096" }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#718096" }}
                />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #dce3ec",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="visits"
                  name="Appointments"
                  fill="#2563eb"
                  radius={[2, 2, 0, 0]}
                  barSize={25}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Operational alerts"
          subtitle="Items that may need staff attention"
        >
          <ul className="alert-list">
            <li className="alert-row">
              <span className="alert-icon">
                <AlertTriangle size={15} />
              </span>
              <div className="alert-copy">
                <strong>{lowStock} medicine items at low stock</strong>
                <span>Review minimum levels and open purchase requests.</span>
                <Link className="link-button" to="/inventory">
                  Review inventory <ArrowRight size={12} />
                </Link>
              </div>
            </li>
            <li className="alert-row">
              <span className="alert-icon blue">
                <Clock3 size={15} />
              </span>
              <div className="alert-copy">
                <strong>{pendingLabs} laboratory orders in progress</strong>
                <span>Review collection, processing and result status.</span>
                <Link className="link-button" to="/laboratory">
                  Open worklist <ArrowRight size={12} />
                </Link>
              </div>
            </li>
          </ul>
        </Panel>
      </div>
      <div className="content-grid two">
        <Panel
          title="Revenue by month"
          subtitle="Payments recorded in the relational invoice ledger."
        >
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData.revenue}
                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#e6ebf1"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#718096" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#718096" }}
                  tickFormatter={(value: number) =>
                    `₹${Math.round(value / 1000)}k`
                  }
                />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value))}
                  contentStyle={{
                    border: "1px solid #dce3ec",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name="Revenue"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="#EFF6FF"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Recent activity"
          subtitle="Latest updates across clinic workflows"
          actions={
            <Link className="link-button" to="/administration/audit-logs">
              View audit log <ArrowRight size={12} />
            </Link>
          }
        >
          <ul className="activity-list">
            {recent.map((event) => (
              <li className="activity-row" key={event.id}>
                <span className="activity-dot" />
                <div className="activity-copy">
                  <strong>
                    {event.action} · {event.area}
                  </strong>
                  <span>
                    {event.actor} · {event.details}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel
        title="Today's appointment schedule"
        subtitle={`${todayAppointments.length} confirmed visits · ${dateLabel}`}
        className="section-gap"
        actions={
          <Link className="link-button" to="/appointments">
            View full schedule <ArrowRight size={12} />
          </Link>
        }
      >
        <AppointmentTable
          rows={todayAppointments}
          data={data}
          mode="confirmed"
          emptyMessage="No confirmed appointments are scheduled for today."
        />
      </Panel>
    </>
  );
}
