import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  Appointment,
  AvailabilityBlock,
  DemoSession,
  Patient,
  UserAccount,
} from "../../lib/api/types";
import {
  api,
  type AppointmentReviewData,
  type AppointmentSlotCheck,
} from "../../lib/api/api";
import { formatDate } from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import {
  EntityFormDialog,
  type EntityField,
} from "../../components/forms/EntityFormDialog";
import {
  Button,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from "../../components/ui";

function clockLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}
const slotTimes = Array.from({ length: 19 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const slotTimeOptions = slotTimes.map((time) => ({
  value: time,
  label: clockLabel(time),
}));
const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const todayString = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const defaultRequestDate = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 13);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
})();
const confirmedStatuses = ["Scheduled", "Checked In", "In Consultation"];
const terminalStatuses = ["Completed", "Cancelled", "Rejected", "No Show"];
const appointmentStatuses = [
  "Pending Approval",
  "Approved",
  "Scheduled",
  "Checked In",
  "In Consultation",
  "Completed",
  "Cancelled",
  "Rejected",
  "No Show",
  "Reschedule Requested",
];
const rescheduleFields: EntityField[] = [
  { name: "date", label: "Preferred new date", type: "date", required: true },
  {
    name: "time",
    label: "Preferred new time",
    type: "select",
    required: true,
    options: slotTimeOptions,
  },
  {
    name: "reason",
    label: "Reason for change",
    type: "textarea",
    required: true,
  },
];
const cancellationFields: EntityField[] = [
  {
    name: "reason",
    label: "Reason for cancellation",
    type: "textarea",
    required: true,
  },
];
const emptyCancellationInitial = { reason: "" };

type SortField =
  "date" | "time" | "patient" | "provider" | "status" | "createdAt";
type DialogState =
  | { kind: "request" }
  | { kind: "reschedule"; appointment: Appointment }
  | { kind: "cancellation"; appointment: Appointment }
  | { kind: "availability" }
  | null;

function requestedDateTime(appointment: Appointment): {
  date: string;
  time: string;
} {
  const waitingForDecision =
    appointment.status === "Pending Approval" ||
    (appointment.status === "Reschedule Requested" &&
      !appointment.proposalById);
  return waitingForDecision
    ? { date: appointment.requestedDate, time: appointment.requestedTime }
    : { date: appointment.date, time: appointment.time };
}

function stateLabel(appointment: Appointment): string {
  if (
    appointment.cancellationRequestedAt &&
    !terminalStatuses.includes(appointment.status)
  )
    return "Cancellation Requested";
  return appointment.status;
}

function sortableValue(
  appointment: Appointment,
  field: SortField,
  patientName: string,
): string {
  const visit = requestedDateTime(appointment);
  if (field === "date") return visit.date;
  if (field === "time") return visit.time;
  if (field === "patient") return patientName.toLowerCase();
  if (field === "provider") return appointment.provider.toLowerCase();
  if (field === "status") return stateLabel(appointment).toLowerCase();
  return appointment.createdAt;
}

function ScheduleSnapshot({
  title,
  rows,
  patients,
}: {
  title: string;
  rows: Appointment[];
  patients: Patient[];
}) {
  return (
    <div className="availability-snapshot">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="table-scroll">
          <table className="data-table compact-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Visit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((item) => (
                  <tr key={item.id}>
                    <td>{clockLabel(item.time)}</td>
                    <td>
                      {patients.find((patient) => patient.id === item.patientId)
                        ?.name ?? "Patient record"}
                    </td>
                    <td>{item.type}</td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-inline">
          No confirmed appointments for this person on the requested date.
        </div>
      )}
    </div>
  );
}

function slotStatus(
  slot: AppointmentSlotCheck,
  kind: "patient" | "doctor",
): string {
  const reason =
    kind === "patient" ? slot.patientConflict : slot.doctorConflict;
  if (!reason) return "Available";
  return reason.includes("already has an appointment")
    ? "Appointment booked"
    : "Marked unavailable";
}

function AppointmentReviewDialog({
  id,
  session,
  onClose,
  onUpdated,
}: {
  id: string;
  session: DemoSession;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [review, setReview] = useState<AppointmentReviewData | null>(null);
  const [currentCheck, setCurrentCheck] = useState<AppointmentSlotCheck | null>(
    null,
  );
  const [suggestionSlots, setSuggestionSlots] = useState<
    AppointmentSlotCheck[]
  >([]);
  const [suggestionDate, setSuggestionDate] = useState(defaultRequestDate);
  const [suggestionTime, setSuggestionTime] = useState("");
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const appointment = review?.appointment;
  const targetDate =
    appointment?.proposedDate ??
    appointment?.requestedDate ??
    appointment?.date ??
    "";
  const targetTime =
    appointment?.proposedTime ??
    appointment?.requestedTime ??
    appointment?.time ??
    "";

  const refresh = useCallback(async () => {
    const next = await api.getAppointmentReview(id);
    setReview(next);
    const requestedDate =
      next.appointment.proposedDate ??
      next.appointment.requestedDate ??
      next.appointment.date;
    const requestedTime =
      next.appointment.proposedTime ??
      next.appointment.requestedTime ??
      next.appointment.time;
    setSuggestionDate(requestedDate);
    if (session.role === "Receptionist") {
      const check = await api.checkAppointmentAvailability({
        patientId: next.appointment.patientId,
        doctorId: next.appointment.doctorId,
        date: requestedDate,
        time: requestedTime,
        excludeAppointmentId: next.appointment.id,
      });
      setCurrentCheck(check);
    } else setCurrentCheck(null);
  }, [id, session.role]);

  useEffect(() => {
    let live = true;
    void refresh().catch((caught) => {
      if (live)
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load the appointment review.",
        );
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  const loadAlternatives = async (date: string) => {
    if (!appointment) return;
    setSuggestionDate(date);
    setSuggestionTime("");
    setError("");
    try {
      const slots = await api.findAvailableAppointmentSlots({
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        date,
        excludeAppointmentId: appointment.id,
      });
      setSuggestionSlots(slots);
      setSuggestionTime(slots[0]?.time ?? "");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load available times.",
      );
    }
  };

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setError("");
    try {
      await action();
      showToast(success);
      await onUpdated();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The appointment action could not be completed.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!appointment)
    return (
      <div className="modal-backdrop" role="presentation">
        <section
          className="modal-dialog appointment-review-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-review-title"
        >
          <div className="modal-heading">
            <div>
              <h2 id="appointment-review-title">Review appointment request</h2>
              <p>Loading appointment details…</p>
            </div>
            <Button onClick={onClose}>Close</Button>
          </div>
          <div className="loading-panel">
            Loading appointment details…
          </div>
        </section>
      </div>
    );

  const requesterCanAccept =
    ["Patient", "Doctor"].includes(session.role) &&
    ((session.role === "Patient" &&
      session.patientId === appointment.patientId) ||
      (session.role === "Doctor" && session.userId === appointment.doctorId));
  const isReceptionist = session.role === "Receptionist";
  const canSchedule =
    isReceptionist &&
    ["Pending Approval", "Reschedule Requested"].includes(appointment.status) &&
    !appointment.proposalById &&
    !appointment.cancellationRequestedAt;
  const canReject = canSchedule;
  const hasCancellationRequest = Boolean(appointment.cancellationRequestedAt);
  const canManageAppointments =
    isReceptionist || session.role === "Clinic Administrator";

  return (
    <div
      className="modal-backdrop appointment-review-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-dialog appointment-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-review-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="appointment-review-title">
              {canManageAppointments
                ? `Review appointment · ${appointment.id}`
                : `Proposed appointment time · ${appointment.id}`}
            </h2>
            <p>
              {canManageAppointments
                ? "Review this appointment and record a reason for any cancellation."
                : "Review the proposed time for your appointment; wider clinic schedules are not shown in this role."}
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
        <div className="appointment-review-body">
          <div className="detail-grid appointment-request-summary">
            <div className="detail-item">
              <span>Patient</span>
              <strong>{review.patient?.name ?? "Patient record"}</strong>
            </div>
            <div className="detail-item">
              <span>Doctor</span>
              <strong>{appointment.provider}</strong>
            </div>
            <div className="detail-item">
              <span>Department</span>
              <strong>{appointment.department}</strong>
            </div>
            <div className="detail-item">
              <span>Requested by</span>
              <strong>
                {appointment.requestedByName} · {appointment.requestedByRole}
              </strong>
            </div>
            <div className="detail-item">
              <span>Requested visit</span>
              <strong>
                {formatDate(targetDate)} · {clockLabel(targetTime)}
              </strong>
            </div>
            <div className="detail-item">
              <span>Visit type</span>
              <strong>{appointment.type}</strong>
            </div>
          </div>
          <p className="appointment-reason">
            <strong>Reason / notes:</strong>{" "}
            {appointment.reason || "No reason supplied."}
          </p>
          {appointment.cancellationRequestedAt && (
            <div className="callout warning-callout">
              <AlertTriangle size={16} />
              <div>
                <strong>
                  Cancellation requested by{" "}
                  {appointment.cancellationRequestedByName ??
                    "Patient / Doctor"}
                  .
                </strong>{" "}
                {appointment.cancellationReason}
              </div>
            </div>
          )}
          {appointment.proposalById && (
            <div className="callout info-callout">
              <Clock3 size={16} />
              <div>
                <strong>Alternative time awaiting acceptance.</strong>{" "}
                {formatDate(appointment.proposedDate ?? "")} ·{" "}
                {clockLabel(appointment.proposedTime ?? "09:00")} proposed by{" "}
                {appointment.proposalByName ?? "Receptionist"}.
              </div>
            </div>
          )}

          {isReceptionist && (
            <>
              <div className="availability-review-grid">
                <ScheduleSnapshot
                  title={`Patient schedule · ${formatDate(targetDate)}`}
                  rows={review.patientSchedule}
                  patients={review.patients}
                />
                <ScheduleSnapshot
                  title={`Doctor schedule · ${formatDate(targetDate)}`}
                  rows={review.doctorSchedule}
                  patients={review.patients}
                />
              </div>
              {(review.patientBlocks.length > 0 ||
                review.doctorBlocks.length > 0) && (
                <div className="availability-block-note">
                  <strong>Marked unavailable:</strong>{" "}
                  {[
                    ...review.patientBlocks.map(
                      (block) =>
                        `Patient ${clockLabel(block.startTime)}–${clockLabel(block.endTime)} (${block.reason})`,
                    ),
                    ...review.doctorBlocks.map(
                      (block) =>
                        `${appointment.provider} ${clockLabel(block.startTime)}–${clockLabel(block.endTime)} (${block.reason})`,
                    ),
                  ].join(" · ")}
                </div>
              )}

              <div className="availability-slot-section">
                <div className="availability-section-heading">
                  <div>
                    <h3>Availability around the requested time</h3>
                    <p>
                      Each 30-minute slot is checked for both people and active
                      unavailable-time blocks.
                    </p>
                  </div>
                  <StatusBadge
                    value={
                      currentCheck?.canSchedule
                        ? "Available for both"
                        : "Conflict to review"
                    }
                  />
                </div>
                <div className="table-scroll">
                  <table className="data-table availability-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Patient</th>
                        <th>Doctor</th>
                        <th>Slot result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.nearbySlots.map((slot) => (
                        <tr key={slot.time}>
                          <td>{clockLabel(slot.time)}</td>
                          <td>
                            <StatusBadge value={slotStatus(slot, "patient")} />
                          </td>
                          <td>
                            <StatusBadge value={slotStatus(slot, "doctor")} />
                          </td>
                          <td>
                            {slot.canSchedule ? (
                              <span className="availability-clear">
                                Available for both
                              </span>
                            ) : (
                              <span className="availability-conflict">
                                {slot.message}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {currentCheck && !currentCheck.canSchedule && (
                  <p className="appointment-conflict-message" role="alert">
                    <AlertTriangle size={15} />
                    {currentCheck.message}
                  </p>
                )}
              </div>
            </>
          )}

          {suggestionOpen && (
            <div className="suggestion-panel">
              <div className="availability-section-heading">
                <div>
                  <h3>Suggest another time</h3>
                  <p>
                    Only slots available for both the selected patient and
                    doctor can be proposed.
                  </p>
                </div>
              </div>
              <div className="suggestion-controls">
                <label className="form-field">
                  <span>Alternative date</span>
                  <input
                    type="date"
                    min={todayString()}
                    value={suggestionDate}
                    onChange={(event) => {
                      void loadAlternatives(event.target.value);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Available time</span>
                  <select
                    value={suggestionTime}
                    onChange={(event) => setSuggestionTime(event.target.value)}
                    disabled={!suggestionSlots.length}
                  >
                    <option value="">
                      {suggestionSlots.length
                        ? "Select a time"
                        : "No available slots for this date"}
                    </option>
                    {suggestionSlots.map((slot) => (
                      <option key={slot.time} value={slot.time}>
                        {clockLabel(slot.time)} · available for both
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="modal-actions">
                <Button onClick={() => setSuggestionOpen(false)}>Close</Button>
                <Button
                  variant="primary"
                  disabled={!suggestionTime || saving || !isReceptionist}
                  onClick={() => {
                    if (suggestionTime)
                      void perform(
                        () =>
                          api.proposeAppointmentTime(
                            id,
                            suggestionDate,
                            suggestionTime,
                          ),
                        "Alternative time sent for Patient/Doctor acceptance.",
                      );
                  }}
                >
                  <Clock3 size={14} />
                  Send proposed time
                </Button>
              </div>
            </div>
          )}

          {canManageAppointments &&
            (canReject ||
              hasCancellationRequest ||
              (!terminalStatuses.includes(appointment.status) &&
                appointment.status !== "Pending Approval" &&
                appointment.status !== "Reschedule Requested")) && (
              <label className="form-field review-reason-field">
                <span>
                  {hasCancellationRequest
                    ? "Cancellation reason"
                    : "Decision reason (required for reject or cancel)"}
                </span>
                <textarea
                  rows={2}
                  value={decisionReason}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  placeholder="Record the reason for this decision…"
                />
              </label>
            )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions review-actions">
            {requesterCanAccept && appointment.proposalById && (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => {
                  void perform(
                    () => api.acceptProposedAppointmentTime(id),
                    "Proposed time accepted. Receptionist will complete scheduling.",
                  );
                }}
              >
                <Check size={14} />
                Accept proposed time
              </Button>
          )}
            {canManageAppointments && (
              <>
                {canSchedule && (
                  <Button
                    variant="primary"
                    disabled={saving || !currentCheck?.canSchedule}
                    title={
                      !currentCheck?.canSchedule
                        ? currentCheck?.message
                        : "Schedule this appointment"
                    }
                    onClick={() => {
                      void perform(
                        () => api.approveAppointment(id),
                        "Appointment approved and scheduled. Patient and Doctor were notified.",
                      );
                    }}
                  >
                    <Check size={14} />
                    Approve &amp; Schedule
                  </Button>
                )}
                {isReceptionist &&
                  !appointment.proposalById &&
                  !hasCancellationRequest &&
                  !terminalStatuses.includes(appointment.status) && (
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setSuggestionOpen((open) => !open);
                        if (!suggestionOpen) void loadAlternatives(targetDate);
                      }}
                    >
                      <RefreshCw size={14} />
                      Suggest Another Time
                    </Button>
                  )}
                {isReceptionist && canReject && (
                  <Button
                    variant="danger"
                    disabled={saving || !decisionReason.trim()}
                    onClick={() => {
                      void perform(
                        () => api.rejectAppointment(id, decisionReason),
                        "Appointment request rejected. Patient and Doctor were notified.",
                      );
                    }}
                  >
                    <XCircle size={14} />
                    Reject request
                  </Button>
                )}
                {hasCancellationRequest &&
                  !terminalStatuses.includes(appointment.status) && (
                    <Button
                      variant="danger"
                      disabled={saving || !decisionReason.trim()}
                      onClick={() => {
                        void perform(
                          () => api.cancelAppointment(id, decisionReason),
                          "Appointment cancelled and affected users were notified.",
                        );
                      }}
                    >
                      <XCircle size={14} />
                      Confirm cancellation
                    </Button>
                  )}
                {!hasCancellationRequest &&
                  !terminalStatuses.includes(appointment.status) &&
                  appointment.status !== "Pending Approval" &&
                  appointment.status !== "Reschedule Requested" && (
                    <Button
                      variant="danger"
                      disabled={saving || !decisionReason.trim()}
                      onClick={() => {
                        void perform(
                          () => api.cancelAppointment(id, decisionReason),
                          "Appointment cancelled and affected users were notified.",
                        );
                      }}
                    >
                      <XCircle size={14} />
                      Cancel appointment
                    </Button>
                  )}
              </>
            )}
            <Button onClick={onClose}>Close review</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AppointmentsPage({ session }: { session: DemoSession }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<UserAccount[]>([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    AvailabilityBlock[]
  >([]);
  const [summary, setSummary] = useState<{
    pendingCount: number;
    todayConfirmedCount: number;
    todayBlocksCount: number;
    conflictingRequestsCount: number;
  } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reviewId, setReviewId] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [dateFilter, setDateFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("search") ?? "");
  const { showToast } = useToast();
  const isReceptionist = session.role === "Receptionist";
  const isClinicAdministrator = session.role === "Clinic Administrator";
  const canManageAppointments = isReceptionist || isClinicAdministrator;
  const isPatient = session.role === "Patient";
  const isDoctor = session.role === "Doctor";
  const canRequest = isPatient || isDoctor || isReceptionist;
  const today = todayString();

  const reload = useCallback(async () => {
    const [
      nextAppointments,
      nextPatients,
      nextDoctors,
      nextBlocks,
      nextSummary,
    ] = await Promise.all([
      api.listAppointmentsForSession(),
      api.listAppointmentPatients(),
      api.listActiveDoctors(),
      api.listAvailabilityBlocksForSession(),
      api.getAppointmentDashboardSummary(today),
    ]);
    setAppointments(nextAppointments);
    setPatients(nextPatients);
    setDoctors(nextDoctors);
    setAvailabilityBlocks(nextBlocks);
    setSummary(nextSummary);
  }, [today]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setQuery(searchParams.get("search") ?? "");
  }, [searchParams]);

  const activePatients = useMemo(
    () => patients.filter((item) => item.status === "Active"),
    [patients],
  );
  const requestFields = useMemo<EntityField[]>(
    () =>
      isPatient
        ? [
            {
              name: "doctorId",
              label: "Doctor",
              type: "select",
              required: true,
              options: doctors.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.department}`,
              })),
            },
            {
              name: "department",
              label: "Department",
              type: "select",
              required: true,
              options: [...new Set(doctors.map((item) => item.department))].map(
                (value) => ({ value, label: value }),
              ),
            },
            {
              name: "requestedDate",
              label: "Preferred date",
              type: "date",
              required: true,
            },
            {
              name: "requestedTime",
              label: "Preferred time",
              type: "select",
              required: true,
              options: slotTimeOptions,
            },
            {
              name: "type",
              label: "Visit type",
              type: "select",
              required: true,
              options: [
                "Consultation",
                "New patient",
                "Follow-up",
                "Review",
              ].map((value) => ({ value, label: value })),
            },
            {
              name: "reason",
              label: "Reason / notes",
              type: "textarea",
              required: true,
            },
          ]
        : [
            {
              name: "patientId",
              label: "Patient",
              type: "select",
              required: true,
              options: activePatients.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.mrn}`,
              })),
            },
            ...(isReceptionist
              ? [
                  {
                    name: "doctorId",
                    label: "Doctor",
                    type: "select" as const,
                    required: true,
                    options: doctors.map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.department}`,
                    })),
                  },
                ]
              : []),
            {
              name: "requestedDate",
              label: "Preferred date",
              type: "date",
              required: true,
            },
            {
              name: "requestedTime",
              label: "Preferred time",
              type: "select",
              required: true,
              options: slotTimeOptions,
            },
            {
              name: "type",
              label: "Visit type",
              type: "select",
              required: true,
              options: [
                "Consultation",
                "New patient",
                "Follow-up",
                "Review",
              ].map((value) => ({ value, label: value })),
            },
            {
              name: "reason",
              label: "Reason / visit notes",
              type: "textarea",
              required: true,
            },
          ],
    [isPatient, doctors, activePatients],
  );
  const requestInitial = useMemo(
    () => ({
      patientId: activePatients[0]?.id ?? "",
      doctorId:
        doctors.find((item) => item.department === "General Medicine")?.id ??
        doctors[0]?.id ??
        "",
      department:
        doctors.find((item) => item.department === "General Medicine")
          ?.department ??
        doctors[0]?.department ??
        "",
      requestedDate: defaultRequestDate,
      requestedTime: "10:30",
      type: "Consultation",
    }),
    [activePatients, doctors],
  );
  const rescheduleTarget =
    dialog?.kind === "reschedule" ? dialog.appointment : null;
  const rescheduleInitial = useMemo(() => {
    if (!rescheduleTarget)
      return { date: defaultRequestDate, time: "10:30", reason: "" };
    const waitingForDecision =
      rescheduleTarget.status === "Pending Approval" ||
      (rescheduleTarget.status === "Reschedule Requested" &&
        !rescheduleTarget.proposalById);
    return {
      date: waitingForDecision
        ? rescheduleTarget.requestedDate
        : (rescheduleTarget.confirmedDate ?? rescheduleTarget.date),
      time: waitingForDecision
        ? rescheduleTarget.requestedTime
        : (rescheduleTarget.confirmedTime ?? rescheduleTarget.time),
      reason: "",
    };
  }, [
    rescheduleTarget?.id,
    rescheduleTarget?.status,
    rescheduleTarget?.proposalById,
    rescheduleTarget?.requestedDate,
    rescheduleTarget?.requestedTime,
    rescheduleTarget?.confirmedDate,
    rescheduleTarget?.confirmedTime,
    rescheduleTarget?.date,
    rescheduleTarget?.time,
  ]);
  const availabilityInitial = useMemo(
    () => ({ date: defaultRequestDate, startTime: "10:30", endTime: "11:00" }),
    [],
  );

  const roleAppointments = useMemo(
    () =>
      appointments.filter((item) => {
        if (isPatient) return item.patientId === session.patientId;
        if (isDoctor) return item.doctorId === session.userId;
        return true;
      }),
    [appointments, isPatient, isDoctor, session.patientId, session.userId],
  );
  const pendingRequests = useMemo(
    () =>
      appointments
        .filter(
          (item) =>
            (["Pending Approval", "Reschedule Requested"].includes(
              item.status,
            ) &&
              !item.proposalById) ||
            (Boolean(item.cancellationRequestedAt) &&
              !terminalStatuses.includes(item.status)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [appointments],
  );
  const patientPending = roleAppointments.filter((item) =>
    ["Pending Approval", "Reschedule Requested"].includes(item.status),
  );
  const patientConfirmed = roleAppointments
    .filter((item) => confirmedStatuses.includes(item.status))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const pastAppointments = roleAppointments.filter((item) =>
    terminalStatuses.includes(item.status),
  );

  const patientNames = useMemo(
    () => new Map(patients.map((item) => [item.id, item.name])),
    [patients],
  );
  const filteredAppointments = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = roleAppointments.filter((appointment) => {
      const patient = patientNames.get(appointment.patientId) ?? "";
      const visit = requestedDateTime(appointment);
      const matchesTerm =
        !term ||
        [
          appointment.id,
          patient,
          appointment.provider,
          appointment.department,
          appointment.type,
          appointment.reason,
          appointment.requestedByName,
          appointment.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesStatus =
        statusFilter === "All statuses" ||
        stateLabel(appointment) === statusFilter;
      const matchesDate =
        !dateFilter ||
        visit.date === dateFilter ||
        appointment.date === dateFilter;
      return matchesTerm && matchesStatus && matchesDate;
    });
    return filtered.sort((a, b) => {
      const valueA = sortableValue(
        a,
        sortField,
        patientNames.get(a.patientId) ?? "",
      );
      const valueB = sortableValue(
        b,
        sortField,
        patientNames.get(b.patientId) ?? "",
      );
      return (
        valueA.localeCompare(valueB, undefined, { numeric: true }) *
        (sortDirection === "asc" ? 1 : -1)
      );
    });
  }, [
    roleAppointments,
    patientNames,
    query,
    statusFilter,
    dateFilter,
    sortField,
    sortDirection,
  ]);

  const requestSubmit = async (values: Record<string, unknown>) => {
    await api.requestAppointment({
      patientId: String(values.patientId ?? ""),
      doctorId: String(values.doctorId ?? ""),
      department: String(values.department ?? ""),
      requestedDate: String(values.requestedDate ?? ""),
      requestedTime: String(values.requestedTime ?? ""),
      type: String(values.type ?? ""),
      reason: String(values.reason ?? ""),
    });
    await reload();
    setDialog(null);
    showToast(
      isPatient
        ? "Appointment request submitted. A receptionist will review the requested time and confirm your appointment."
        : "Appointment request submitted and is awaiting receptionist approval.",
    );
  };

  const changeSubmit = async (
    appointment: Appointment,
    values: Record<string, unknown>,
  ) => {
    await api.requestAppointmentReschedule(appointment.id, {
      date: String(values.date ?? ""),
      time: String(values.time ?? ""),
      reason: String(values.reason ?? ""),
    });
    await reload();
    setDialog(null);
    showToast(
      "Appointment time change requested. Receptionist will review availability.",
    );
  };

  const cancellationSubmit = async (
    appointment: Appointment,
    values: Record<string, unknown>,
  ) => {
    await api.requestAppointmentCancellation(
      appointment.id,
      String(values.reason ?? ""),
    );
    await reload();
    setDialog(null);
    showToast("Cancellation request sent to Receptionist.");
  };

  const availabilityFields = useMemo<EntityField[]>(
    () => [
      {
        name: "target",
        label: "Unavailable person",
        type: "select",
        required: true,
        options: [
          ...doctors.map((item) => ({
            value: `Doctor|${item.id}`,
            label: `Doctor · ${item.name} · ${item.department}`,
          })),
          ...activePatients.map((item) => ({
            value: `Patient|${item.id}`,
            label: `Patient · ${item.name} · ${item.mrn}`,
          })),
        ],
      },
      { name: "date", label: "Unavailable date", type: "date", required: true },
      {
        name: "startTime",
        label: "Start time",
        type: "select",
        required: true,
        options: slotTimeOptions,
      },
      {
        name: "endTime",
        label: "End time",
        type: "select",
        required: true,
        options: [...slotTimeOptions, { value: "17:30", label: "5:30 PM" }],
      },
      { name: "reason", label: "Reason", type: "text", required: true },
    ],
    [doctors, activePatients],
  );

  const markUnavailable = async (values: Record<string, unknown>) => {
    const [targetType, targetId] = String(values.target ?? "").split("|");
    const startTime = String(values.startTime ?? "");
    const endTime = String(values.endTime ?? "");
    if (!["Doctor", "Patient"].includes(targetType) || !targetId)
      throw new Error("Select a Patient or Doctor to mark unavailable.");
    if (timeToMinutes(endTime) <= timeToMinutes(startTime))
      throw new Error("The unavailable time must end after it starts.");
    await api.create("availabilityBlocks", {
      targetType: targetType as "Doctor" | "Patient",
      targetId,
      date: String(values.date ?? ""),
      startTime,
      endTime,
      reason: String(values.reason ?? ""),
      active: true,
      createdById: session.userId,
    });
    await reload();
    setDialog(null);
    showToast(
      "Unavailable time saved. Conflicting appointment slots will be blocked.",
    );
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const onProgress = async (
    appointment: Appointment,
    status: Appointment["status"],
  ) => {
    try {
      await api.transitionAppointment(appointment.id, status);
      await reload();
      showToast(`Appointment ${appointment.id} updated to ${status}.`);
    } catch (caught) {
      showToast(
        caught instanceof Error
          ? caught.message
          : "Unable to update appointment.",
        "error",
      );
    }
  };

  const appointmentActions = (appointment: Appointment) => {
    const actions = [];
    if (isPatient || isDoctor) {
      if (
        appointment.proposalById &&
        appointment.status === "Reschedule Requested"
      )
        actions.push(
          <Button
            key="accept"
            size="sm"
            variant="primary"
            onClick={() => {
              setReviewId(appointment.id);
            }}
          >
            <Check size={12} />
            Review proposed time
          </Button>,
        );
      if (
        !appointment.proposalById &&
        !appointment.cancellationRequestedAt &&
        !terminalStatuses.includes(appointment.status)
      ) {
        actions.push(
          <Button
            key="change"
            size="sm"
            onClick={() => setDialog({ kind: "reschedule", appointment })}
          >
            <RefreshCw size={12} />
            Request change
          </Button>,
        );
        actions.push(
          <Button
            key="cancel"
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: "cancellation", appointment })}
          >
            Request cancellation
          </Button>,
        );
      }
      if (appointment.cancellationRequestedAt)
        actions.push(
          <span className="activity-kicker" key="cancel-pending">
            Cancellation pending
          </span>,
        );
    }
    if (canManageAppointments) {
      if (
        isReceptionist &&
        ["Pending Approval", "Reschedule Requested"].includes(
          appointment.status,
        ) ||
        (isReceptionist && appointment.cancellationRequestedAt)
      )
        actions.push(
          <Button
            key="review"
            size="sm"
            variant="secondary"
            onClick={() => setReviewId(appointment.id)}
          >
            <CalendarDays size={12} />
            Review
          </Button>,
        );
      if (appointment.status === "Scheduled")
        actions.push(
          <Button
            key="checkin"
            size="sm"
            variant="secondary"
            onClick={() => {
              void onProgress(appointment, "Checked In");
            }}
          >
            <Check size={12} />
            Check in
          </Button>,
        );
      if (appointment.status === "Checked In")
        actions.push(
          <Button
            key="start-consultation"
            size="sm"
            variant="secondary"
            onClick={() => {
              void onProgress(appointment, "In Consultation");
            }}
          >
            <Check size={12} />
            Start consultation
          </Button>,
        );
      if (appointment.status === "In Consultation")
        actions.push(
          <Button
            key="complete"
            size="sm"
            variant="secondary"
            onClick={() => {
              void onProgress(appointment, "Completed");
            }}
          >
            <Check size={12} />
            Complete
          </Button>,
        );
      if (appointment.status === "Scheduled" && appointment.noShowEligible)
        actions.push(
          <Button
            key="noshow"
            size="sm"
            variant="ghost"
            onClick={() => {
              void onProgress(appointment, "No Show");
            }}
          >
            No show
          </Button>,
        );
      if (
        !terminalStatuses.includes(appointment.status) &&
        appointment.status !== "Pending Approval" &&
        appointment.status !== "Reschedule Requested" &&
        !actions.some((action) => action.key === "review")
      )
        actions.push(
          <Button
            key="cancel-review"
            size="sm"
            variant="ghost"
            onClick={() => setReviewId(appointment.id)}
          >
            Cancel
          </Button>,
        );
    }
    if (
      (isDoctor && appointment.status === "Scheduled") ||
      (isDoctor && appointment.status === "Checked In")
    )
      actions.push(
        <Button
          key="start"
          size="sm"
          variant="secondary"
          onClick={() => {
            void onProgress(appointment, "In Consultation");
          }}
        >
          <Check size={12} />
          Start visit
        </Button>,
      );
    if (isDoctor && appointment.status === "In Consultation")
      actions.push(
        <Button
          key="complete-doctor"
          size="sm"
          variant="secondary"
          onClick={() => {
            void onProgress(appointment, "Completed");
          }}
        >
          <Check size={12} />
          Complete visit
        </Button>,
      );
    return <div className="toolbar-line">{actions}</div>;
  };

  const registerTable = (
    rows: Appointment[],
    title: string,
    subtitle: string,
  ) => (
    <Panel title={title} subtitle={subtitle} className="section-gap">
      {!rows.length ? (
        <EmptyState
          title="No appointments to show"
          detail="Requests and visits for this role will appear here."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table appointment-register-table">
            <thead>
              <tr>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("createdAt")}
                  >
                    Visit / Request ID
                  </button>
                </th>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("patient")}
                  >
                    Patient
                  </button>
                </th>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("provider")}
                  >
                    Doctor
                  </button>
                </th>
                <th>Department</th>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("date")}
                  >
                    Date
                  </button>
                </th>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("time")}
                  >
                    Time
                  </button>
                </th>
                <th>Visit type</th>
                <th>Requested by</th>
                <th>
                  <button
                    className="th-sort"
                    onClick={() => toggleSort("status")}
                  >
                    Status
                  </button>
                </th>
                <th className="actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((appointment) => {
                const visit = requestedDateTime(appointment);
                const patientName =
                  patientNames.get(appointment.patientId) ?? "Patient record";
                return (
                  <tr key={appointment.id}>
                    <td className="mono">
                      {appointment.id}
                      <small className="table-subline">
                        Created {formatDate(appointment.createdAt.slice(0, 10))}{" "}
                        · {appointment.createdAt.slice(11, 16)}
                      </small>
                    </td>
                    <td>
                      {isPatient ? (
                        "My appointment"
                      ) : (
                        <Link
                          className="link-button"
                          to={`/patients/${appointment.patientId}`}
                        >
                          {patientName}
                        </Link>
                      )}
                    </td>
                    <td>{appointment.provider}</td>
                    <td>{appointment.department}</td>
                    <td>
                      {formatDate(visit.date)}
                      {appointment.proposalById && appointment.proposedDate && (
                        <small className="table-subline">
                          Proposed {formatDate(appointment.proposedDate)}
                        </small>
                      )}
                    </td>
                    <td>
                      {clockLabel(visit.time)}
                      {appointment.proposalById && appointment.proposedTime && (
                        <small className="table-subline">
                          Proposed {clockLabel(appointment.proposedTime)}
                        </small>
                      )}
                    </td>
                    <td>{appointment.type}</td>
                    <td>
                      {appointment.requestedByName} ·{" "}
                      {appointment.requestedByRole}
                    </td>
                    <td>
                      <StatusBadge value={stateLabel(appointment)} />
                    </td>
                    <td className="row-actions">
                      {appointmentActions(appointment)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle={
          isPatient
            ? "Request visits and manage your own appointment details."
            : isDoctor
              ? "Submit appointment requests and review your assigned patient schedule."
              : "Review requests, confirm appointments, and manage clinic availability."
        }
        actions={
          <>
            {isPatient && (
              <Button
                variant="primary"
                onClick={() => setDialog({ kind: "request" })}
              >
                <Plus size={15} />
                Book Appointment
              </Button>
            )}
            {isDoctor && (
              <Button
                variant="primary"
                onClick={() => setDialog({ kind: "request" })}
              >
                <Plus size={15} />
                Schedule Appointment
              </Button>
            )}
            {isReceptionist && (
              <>
                <Button
                  variant="primary"
                  onClick={() => setDialog({ kind: "request" })}
                >
                  <Plus size={15} />
                  Schedule Appointment
                </Button>
                <Button onClick={() => setDialog({ kind: "availability" })}>
                  <Clock3 size={15} />
                  Mark unavailable time
                </Button>
              </>
            )}
          </>
        }
      />
      {canRequest && (
        <div className="callout info-callout">
          <CalendarDays size={16} />
          <div>
            <strong>
              {isPatient
                ? "Appointment requests are not confirmed bookings."
                : isReceptionist
                  ? "Appointments remain requests until Receptionist approval."
                  : "Doctor schedules remain requests until Receptionist approval."}
            </strong>{" "}
            New requests stay <em>Pending Approval</em>.{" "}
            {isReceptionist
              ? "Select an active patient and doctor; "
              : "The signed-in Patient/Doctor identity is applied automatically; "}
            access and availability are checked.
          </div>
        </div>
      )}

      {(isReceptionist || isDoctor) && summary && (
        <div className="metric-grid appointment-metric-grid section-gap">
          <Metric
            label={
              isReceptionist
                ? "Pending appointment requests"
                : "My pending requests"
            }
            value={summary.pendingCount}
            detail="Awaiting Receptionist review"
            icon={<CalendarDays size={16} />}
          />
          <Metric
            label={
              isReceptionist
                ? "Confirmed appointments today"
                : "My appointments today"
            }
            value={summary.todayConfirmedCount}
            detail="Scheduled, checked in, or in consultation"
            icon={<Check size={16} />}
          />
          <Metric
            label={
              isReceptionist
                ? "Requests with conflicts"
                : "Availability conflicts"
            }
            value={summary.conflictingRequestsCount}
            detail="Patient or Doctor availability needs review"
            icon={<AlertTriangle size={16} />}
          />
          <Metric
            label={
              isReceptionist
                ? "Unavailable blocks today"
                : "Unavailable periods today"
            }
            value={summary.todayBlocksCount}
            detail="Patient and Doctor schedule blocks"
            icon={<Clock3 size={16} />}
          />
        </div>
      )}

      {isReceptionist && (
        <Panel
          title="Appointment Requests"
          subtitle={`${pendingRequests.length} request or cancellation item${pendingRequests.length === 1 ? "" : "s"} require review.`}
          className="section-gap"
        >
          <div className="table-scroll">
            <table className="data-table appointment-request-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Department</th>
                  <th>Requested date</th>
                  <th>Requested time</th>
                  <th>Requested by</th>
                  <th>Visit type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.length ? (
                  pendingRequests.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{item.id}</td>
                      <td>
                        {patientNames.get(item.patientId) ?? "Patient record"}
                      </td>
                      <td>{item.provider}</td>
                      <td>{item.department}</td>
                      <td>{formatDate(item.requestedDate)}</td>
                      <td>{clockLabel(item.requestedTime)}</td>
                      <td>
                        {item.cancellationRequestedAt
                          ? `${item.cancellationRequestedByName ?? "User"} · ${item.cancellationRequestedByRole ?? ""}`
                          : `${item.requestedByName} · ${item.requestedByRole}`}
                      </td>
                      <td>{item.type}</td>
                      <td>
                        <StatusBadge
                          value={
                            item.cancellationRequestedAt
                              ? "Cancellation Requested"
                              : item.status
                          }
                        />
                      </td>
                      <td>
                        {formatDate(item.createdAt.slice(0, 10))} ·{" "}
                        {item.createdAt.slice(11, 16)}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setReviewId(item.id)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="table-empty">
                      No requests or cancellation actions are waiting for
                      Receptionist review.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {isReceptionist && (
        <Panel
          title="Clinic availability blocks"
          subtitle="Unavailable intervals are checked against both patient and Doctor schedules before approval."
          className="section-gap"
          actions={
            <Button
              size="sm"
              onClick={() => setDialog({ kind: "availability" })}
            >
              <Plus size={13} />
              Add unavailable time
            </Button>
          }
        >
          {availabilityBlocks.filter((item) => item.active).length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Date</th>
                    <th>Unavailable</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {availabilityBlocks
                    .filter((item) => item.active)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.targetType === "Doctor"
                            ? doctors.find(
                                (doctor) => doctor.id === item.targetId,
                              )?.name
                            : patients.find(
                                (patient) => patient.id === item.targetId,
                              )?.name}{" "}
                          · {item.targetType}
                        </td>
                        <td>{formatDate(item.date)}</td>
                        <td>
                          {clockLabel(item.startTime)}–
                          {clockLabel(item.endTime)}
                        </td>
                        <td>{item.reason}</td>
                        <td className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void api
                                .archive("availabilityBlocks", item.id)
                                .then(reload)
                                .then(() =>
                                  showToast("Unavailable time cleared."),
                                );
                            }}
                          >
                            Clear
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-inline">
              No active unavailable-time blocks.
            </div>
          )}
        </Panel>
      )}

      {isPatient || isDoctor ? (
        <>
          <div className="content-grid two section-gap">
            <Panel
              title={isPatient ? "Pending Requests" : "My Pending Requests"}
              subtitle="Pending requests are not confirmed appointments."
            >
              {patientPending.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Appointment</th>
                        <th>Date requested</th>
                        <th>Time</th>
                        <th>Doctor</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientPending.map((item) => (
                        <tr key={item.id}>
                          <td className="mono">
                            {item.id}
                            <small className="table-subline">
                              {item.type} · {item.department}
                            </small>
                          </td>
                          <td>{formatDate(item.requestedDate)}</td>
                          <td>{clockLabel(item.requestedTime)}</td>
                          <td>{item.provider}</td>
                          <td>
                            <StatusBadge value={stateLabel(item)} />
                          </td>
                          <td className="row-actions">
                            {item.proposalById ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setReviewId(item.id)}
                              >
                                Review proposed time
                              </Button>
                            ) : (
                              <div className="toolbar-line">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    setDialog({
                                      kind: "reschedule",
                                      appointment: item,
                                    })
                                  }
                                >
                                  Request change
                                </Button>
                                {!item.cancellationRequestedAt && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setDialog({
                                        kind: "cancellation",
                                        appointment: item,
                                      })
                                    }
                                  >
                                    Request cancellation
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No pending appointment requests"
                  detail="New requests will appear here until Receptionist review."
                />
              )}
            </Panel>
            <Panel
              title="Confirmed Appointments"
              subtitle={`${patientConfirmed.length} scheduled visit${patientConfirmed.length === 1 ? "" : "s"} linked to your account.`}
            >
              {patientConfirmed.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Department</th>
                        <th>Doctor</th>
                        <th>Visit</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientConfirmed.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDate(item.date)}</td>
                          <td>{clockLabel(item.time)}</td>
                          <td>{item.department}</td>
                          <td>{item.provider}</td>
                          <td>{item.type}</td>
                          <td>
                            <StatusBadge value={stateLabel(item)} />
                          </td>
                          <td className="row-actions">
                            <div className="toolbar-line">
                              {!item.cancellationRequestedAt && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      setDialog({
                                        kind: "reschedule",
                                        appointment: item,
                                      })
                                    }
                                  >
                                    Request change
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setDialog({
                                        kind: "cancellation",
                                        appointment: item,
                                      })
                                    }
                                  >
                                    Request cancellation
                                  </Button>
                                </>
                              )}
                              {item.cancellationRequestedAt && (
                                <span className="activity-kicker">
                                  Cancellation requested
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No confirmed appointments"
                  detail="Only a Receptionist can confirm a requested appointment time."
                />
              )}
            </Panel>
          </div>
          {pastAppointments.length > 0 && (
            <Panel
              title="Appointment history"
              subtitle="Your own completed, cancelled, rejected, and no-show visits."
              className="section-gap"
            >
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Visit ID</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Doctor</th>
                      <th>Visit type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastAppointments.map((item) => (
                      <tr key={item.id}>
                        <td className="mono">{item.id}</td>
                        <td>{formatDate(item.date)}</td>
                        <td>{clockLabel(item.time)}</td>
                        <td>{item.provider}</td>
                        <td>{item.type}</td>
                        <td>
                          <StatusBadge value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      ) : (
        <>
          <div className="appointment-toolbar section-gap">
            <label className="search-field">
              <span className="sr-only">Search appointments</span>
              <input
                aria-label="Search appointment register"
                placeholder="Search ID, patient, Doctor, or reason…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="appointment-filter-controls">
              <label className="sr-only" htmlFor="appointment-status-filter">
                Filter by status
              </label>
              <select
                id="appointment-status-filter"
                className="filter-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option>All statuses</option>
                {[...appointmentStatuses, "Cancellation Requested"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
              <label className="sr-only" htmlFor="appointment-date-filter">
                Filter by date
              </label>
              <input
                id="appointment-date-filter"
                className="filter-select date-filter"
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
              />
              <span className="result-count">
                {filteredAppointments.length} appointments
              </span>
            </div>
          </div>
          {registerTable(
            filteredAppointments,
            "Appointment schedule & register",
            `${filteredAppointments.length} ${isReceptionist ? "clinic" : isDoctor ? "assigned" : "all"} appointment records · compact table view`,
          )}
        </>
      )}

      {dialog?.kind === "request" && (
        <EntityFormDialog
          title={
            isReceptionist
              ? "Schedule Appointment"
              : isPatient
                ? "Book Appointment"
                : "Schedule Appointment Request"
          }
          fields={requestFields}
          initial={requestInitial}
          onClose={() => setDialog(null)}
          onSubmit={requestSubmit}
          submitLabel="Submit request"
        />
      )}
      {dialog?.kind === "reschedule" && (
        <EntityFormDialog
          title={`Request time change · ${dialog.appointment.id}`}
          fields={rescheduleFields}
          initial={rescheduleInitial}
          onClose={() => setDialog(null)}
          onSubmit={(values) => changeSubmit(dialog.appointment, values)}
          submitLabel="Request change"
        />
      )}
      {dialog?.kind === "cancellation" && (
        <EntityFormDialog
          title={`Request cancellation · ${dialog.appointment.id}`}
          fields={[
            {
              name: "reason",
              label: "Reason for cancellation",
              type: "textarea",
              required: true,
            },
          ]}
          initial={{ reason: "" }}
          onClose={() => setDialog(null)}
          onSubmit={(values) => cancellationSubmit(dialog.appointment, values)}
          submitLabel="Send request"
        />
      )}
      {dialog?.kind === "availability" && (
        <EntityFormDialog
          title="Mark unavailable time"
          fields={availabilityFields}
          initial={availabilityInitial}
          onClose={() => setDialog(null)}
          onSubmit={markUnavailable}
          submitLabel="Save unavailable time"
        />
      )}
      {reviewId && (
        <AppointmentReviewDialog
          id={reviewId}
          session={session}
          onClose={() => setReviewId("")}
          onUpdated={reload}
        />
      )}
    </>
  );
}
