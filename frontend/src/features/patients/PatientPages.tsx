import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Plus,
  UserPlus,
} from "lucide-react";
import { api } from "../../lib/api/api";
import type {
  Appointment,
  Consultation,
  LabOrder,
  Patient,
  Prescription,
  Role,
} from "../../lib/api/types";
import { formatDate, makeId } from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import { CrudPage } from "../../components/data/CrudPage";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import { Button, PageHeader, Panel, StatusBadge } from "../../components/ui";

const patientFields = [
  { name: "name", label: "Full name", required: true },
  {
    name: "dateOfBirth",
    label: "Date of birth",
    type: "date" as const,
    required: true,
  },
  {
    name: "sex",
    label: "Sex",
    type: "select" as const,
    required: true,
    options: ["Female", "Male", "Other"].map((value) => ({
      value,
      label: value,
    })),
  },
  {
    name: "phone",
    label: "Phone number",
    type: "tel" as const,
    required: true,
  },
  { name: "email", label: "Email address", type: "email" as const },
  {
    name: "bloodGroup",
    label: "Blood group",
    type: "select" as const,
    options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
      (value) => ({ value, label: value }),
    ),
  },
  { name: "emergencyContact", label: "Emergency contact", required: true },
  {
    name: "status",
    label: "Record status",
    type: "select" as const,
    required: true,
    options: ["Active", "Inactive"].map((value) => ({ value, label: value })),
  },
];

export function PatientsPage() {
  const columns: TableColumn<never>[] = [
    { key: "mrn", label: "Patient ID" },
    {
      key: "name",
      label: "Patient name",
      render: (row: never) => (
        <Link
          className="link-button"
          to={`/patients/${(row as { id: string }).id}`}
        >
          {(row as { name: string }).name}
        </Link>
      ),
    },
    {
      key: "dateOfBirth",
      label: "Date of birth",
      render: (row: never) =>
        formatDate((row as { dateOfBirth: string }).dateOfBirth),
    },
    { key: "phone", label: "Phone" },
    {
      key: "lastVisit",
      label: "Last visit",
      render: (row: never) =>
        formatDate((row as { lastVisit: string }).lastVisit),
    },
    { key: "status", label: "Status" },
  ];
  return (
    <CrudPage
      collection="patients"
      title="Patients"
      description="Patient registration, contact details, and linked care history."
      columns={columns as never}
      fields={patientFields}
      createLabel=""
      pageActions={
        <Link to="/patients/new">
          <Button variant="primary">
            <UserPlus size={15} />
            Register patient
          </Button>
        </Link>
      }
    />
  );
}

export function RegisterPatientPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    dateOfBirth: "",
    sex: "",
    phone: "",
    email: "",
    bloodGroup: "",
    emergencyContact: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof typeof form, string>>
  >({});
  const change = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };
  const validate = () => {
    const next: Partial<Record<keyof typeof form, string>> = {};
    if (!form.name.trim()) next.name = "Enter the patient’s full name.";
    if (!form.dateOfBirth) next.dateOfBirth = "Select a date of birth.";
    if (!form.sex) next.sex = "Select a sex value.";
    if (!form.phone.trim()) next.phone = "Enter a phone number.";
    if (!form.emergencyContact.trim())
      next.emergencyContact = "Enter an emergency contact.";
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    )
      next.email = "Enter a valid email address.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setError("");
    try {
      await api.create("patients", {
        ...form,
        sex: form.sex as Patient["sex"],
        id: makeId("pat"),
        mrn: `CF-${Math.floor(1000 + Math.random() * 8999)}`,
        registeredAt: new Date().toISOString().slice(0, 10),
        lastVisit: "—",
        status: "Active",
      });
      showToast("Patient registered.");
      navigate("/patients");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to register patient.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Clinical · Patients"
        title="Register patient"
        subtitle="Create a patient record."
        actions={
          <Link to="/patients">
            <Button>
              <ArrowLeft size={15} />
              Back to patients
            </Button>
          </Link>
        }
      />
      <div className="callout">
        <UserPlus size={16} />
        <div>
          <strong>Patient information.</strong> Enter accurate details and review them before saving.
        </div>
      </div>
      <Panel
        title="Patient details"
        subtitle="Complete the required fields to create a new patient record."
        className="section-gap"
      >
        <form onSubmit={submit} noValidate className="entity-form two-col-form">
          <div className="form-grid">
            <label className="form-field">
              <span>
                Full name <span className="required-mark">*</span>
              </span>
              <input
                required
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "patient-name-error" : undefined
                }
                value={form.name}
                onChange={(event) => change("name", event.target.value)}
              />
              {fieldErrors.name && (
                <small
                  id="patient-name-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.name}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>
                Date of birth <span className="required-mark">*</span>
              </span>
              <input
                type="date"
                required
                aria-invalid={Boolean(fieldErrors.dateOfBirth)}
                aria-describedby={
                  fieldErrors.dateOfBirth ? "patient-dob-error" : undefined
                }
                value={form.dateOfBirth}
                onChange={(event) => change("dateOfBirth", event.target.value)}
              />
              {fieldErrors.dateOfBirth && (
                <small
                  id="patient-dob-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.dateOfBirth}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>
                Sex <span className="required-mark">*</span>
              </span>
              <select
                required
                aria-invalid={Boolean(fieldErrors.sex)}
                aria-describedby={
                  fieldErrors.sex ? "patient-sex-error" : undefined
                }
                value={form.sex}
                onChange={(event) => change("sex", event.target.value)}
              >
                <option value="">Select</option>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
              {fieldErrors.sex && (
                <small
                  id="patient-sex-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.sex}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>
                Phone number <span className="required-mark">*</span>
              </span>
              <input
                type="tel"
                required
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={
                  fieldErrors.phone ? "patient-phone-error" : undefined
                }
                value={form.phone}
                onChange={(event) => change("phone", event.target.value)}
              />
              {fieldErrors.phone && (
                <small
                  id="patient-phone-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.phone}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>Email address</span>
              <input
                type="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? "patient-email-error" : undefined
                }
                value={form.email}
                onChange={(event) => change("email", event.target.value)}
              />
              {fieldErrors.email && (
                <small
                  id="patient-email-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.email}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>Blood group</span>
              <select
                value={form.bloodGroup}
                onChange={(event) => change("bloodGroup", event.target.value)}
              >
                <option value="">Not recorded</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </select>
            </label>
            <label className="form-field field-wide">
              <span>
                Emergency contact <span className="required-mark">*</span>
              </span>
              <input
                required
                aria-invalid={Boolean(fieldErrors.emergencyContact)}
                aria-describedby={
                  fieldErrors.emergencyContact
                    ? "patient-emergency-error"
                    : undefined
                }
                value={form.emergencyContact}
                onChange={(event) =>
                  change("emergencyContact", event.target.value)
                }
              />
              {fieldErrors.emergencyContact && (
                <small
                  id="patient-emergency-error"
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.emergencyContact}
                </small>
              )}
            </label>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button type="button" onClick={() => navigate("/patients")}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              <Plus size={15} />
              {saving ? "Registering…" : "Create patient record"}
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

export function PatientProfilePage({
  role = "Clinic Administrator",
}: {
  role?: Role;
}) {
  const { id = "" } = useParams();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [labs, setLabs] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [patients, appts] = await Promise.all([
          api.list("patients"),
          api.list("appointments"),
        ]);
        let visits: Consultation[] = [];
        let rx: Prescription[] = [];
        let labOrders: LabOrder[] = [];
        if (role !== "Receptionist")
          [visits, rx, labOrders] = await Promise.all([
            api.list("consultations"),
            api.list("prescriptions"),
            api.list("labOrders"),
          ]);
        if (!live) return;
        setPatient(patients.find((item) => item.id === id) ?? null);
        setAppointments(appts.filter((item) => item.patientId === id));
        setConsultations(visits.filter((item) => item.patientId === id));
        setPrescriptions(rx.filter((item) => item.patientId === id));
        setLabs(labOrders.filter((item) => item.patientId === id));
      } catch {
        if (live) setLoadError(true);
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [id, role, retryKey]);
  if (loadError)
    return (
      <>
        <PageHeader
          title="Patient profile"
          subtitle="The patient record could not be loaded."
        />
        <Panel>
          <p role="alert">Unable to load patient records.</p>
          <Button onClick={() => setRetryKey((key) => key + 1)}>Retry</Button>
        </Panel>
      </>
    );
  if (loading)
    return (
      <>
        <PageHeader
          title="Patient profile"
          subtitle="Loading patient records…"
        />
        <Panel>Loading patient records…</Panel>
      </>
    );
  if (!patient)
    return (
      <>
        <PageHeader
          title="Patient profile"
          subtitle="The requested patient record could not be found."
          actions={
            <Link to="/patients">
              <Button>
                <ArrowLeft size={15} />
                Patients
              </Button>
            </Link>
          }
        />
        <Panel>
          <div className="empty-state">
            No patient record is available for this identifier.
          </div>
        </Panel>
      </>
    );
  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <>
      <PageHeader
        eyebrow="Clinical · Patient profile"
        title="Patient profile"
        actions={
          <Link to="/patients">
            <Button>
              <ArrowLeft size={15} />
              Back to patients
            </Button>
          </Link>
        }
      />
      <Panel className="patient-panel">
        <div className="patient-summary">
          <div className="avatar">{initials}</div>
          <div>
            <h2>{patient.name}</h2>
            <p>
              {patient.mrn} · Registered {formatDate(patient.registeredAt)} ·{" "}
              <StatusBadge value={patient.status} />
            </p>
          </div>
        </div>
        <div className="detail-grid">
          {[
            ["Date of birth", formatDate(patient.dateOfBirth)],
            ["Sex", patient.sex],
            ["Phone", patient.phone],
            ["Email", patient.email || "—"],
            ["Blood group", patient.bloodGroup || "Not recorded"],
            ["Emergency contact", patient.emergencyContact],
            ["Last visit", formatDate(patient.lastVisit)],
          ].map(([label, value]) => (
            <div className="detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </Panel>
      <div className="content-grid equal section-gap">
        <Panel
          title="Appointments"
          subtitle={`${appointments.length} linked visits`}
        >
          <ul className="activity-list">
            {appointments.slice(0, 4).map((item) => (
              <li className="activity-row" key={item.id}>
                <CalendarDays size={15} className="activity-kicker" />
                <div className="activity-copy">
                  <strong>
                    {formatDate(item.date)} · {item.time} · {item.department}
                  </strong>
                  <span>
                    {item.provider} · {item.type} · {item.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/appointments" className="panel-link">
            Open appointments <ArrowLeft size={13} />
          </Link>
        </Panel>
        {role !== "Receptionist" && (
          <Panel
            title="Medical history"
            subtitle={`${consultations.length + labs.length + prescriptions.length} linked records`}
          >
            <ul className="activity-list">
              {[
                ...consultations.map((item) => ({
                  id: item.id,
                  date: item.date,
                  label: "Consultation",
                  detail: item.reason,
                })),
                ...labs.map((item) => ({
                  id: item.id,
                  date: item.orderedAt,
                  label: "Laboratory",
                  detail: item.test,
                })),
                ...prescriptions.map((item) => ({
                  id: item.id,
                  date: item.date,
                  label: "Prescription",
                  detail: item.items.map((line) => line.dose).join(", "),
                })),
              ]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 6)
                .map((item) => (
                  <li className="activity-row" key={item.id}>
                    <FileText size={15} className="activity-kicker" />
                    <div className="activity-copy">
                      <strong>
                        {item.label} · {formatDate(item.date)}
                      </strong>
                      <span>{item.detail}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

interface MedicalRecordRow {
  id: string;
  patientId: string;
  date: string;
  category: string;
  description: string;
  status: string;
}
export function MedicalRecordsPage({
  role,
  patientId,
}: {
  role: Role;
  patientId?: string;
}) {
  const [data, setData] = useState<{
    patients: Patient[];
    rows: MedicalRecordRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      api.list("patients"),
      api.list("consultations"),
      api.list("prescriptions"),
      api.list("labOrders"),
    ])
      .then(([patients, consultations, prescriptions, labs]) => {
        const rows: MedicalRecordRow[] = [
          ...consultations.map((item) => ({
            id: item.id,
            patientId: item.patientId,
            date: item.date,
            category: "Consultation",
            description: item.reason,
            status: item.status,
          })),
          ...prescriptions.map((item) => ({
            id: item.id,
            patientId: item.patientId,
            date: item.date,
            category: "Prescription",
            description: item.items.map((line) => line.dose).join("; "),
            status: item.status,
          })),
          ...labs.map((item) => ({
            id: item.id,
            patientId: item.patientId,
            date: item.orderedAt,
            category: "Laboratory",
            description: item.test,
            status: item.status,
          })),
        ];
        if (live)
          setData({
            patients,
            rows:
              role === "Patient"
                ? rows.filter(
                    (item) =>
                      Boolean(patientId) &&
                      item.patientId === patientId &&
                      (item.category !== "Laboratory" ||
                        item.status === "Reviewed"),
                  )
                : rows,
          });
      })
      .catch(() => {
        if (live) setLoadError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [role, patientId, retryKey]);
  const columns: TableColumn<MedicalRecordRow>[] = [
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    {
      key: "patientId",
      label: "Patient",
      render: (row) => {
        const patient = data?.patients.find(
          (item) => item.id === row.patientId,
        );
        return role === "Patient" ? (
          "My record"
        ) : (
          <Link className="link-button" to={`/patients/${row.patientId}`}>
            {patient?.name ?? "Patient"}
          </Link>
        );
      },
    },
    { key: "category", label: "Record type" },
    { key: "description", label: "Description" },
    { key: "status", label: "Status" },
  ];
  if (role === "Patient" && !patientId)
    return (
      <>
        <PageHeader
          title="Medical Records"
          subtitle="No patient account is linked to this session."
        />
        <Panel>
          <p role="alert">
            Contact the clinic administrator to link your account.
          </p>
        </Panel>
      </>
    );
  if (loading)
    return (
      <>
        <PageHeader
          title="Medical Records"
          subtitle="Loading the clinical timeline…"
        />
        <Panel>Loading records…</Panel>
      </>
    );
  if (loadError)
    return (
      <>
        <PageHeader
          title="Medical Records"
          subtitle="The clinical timeline could not be loaded."
        />
        <Panel>
          <p role="alert">Unable to load records.</p>
          <Button onClick={() => setRetryKey((key) => key + 1)}>Retry</Button>
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        title="Medical Records"
        subtitle={
          role === "Patient"
            ? "Records linked to your patient profile."
            : "Clinical encounters, prescriptions, and laboratory records across the clinic."
        }
      />
      <Panel
        title="Clinical record timeline"
        subtitle={`${data?.rows.length ?? 0} records · persisted clinic data`}
      >
        <DataTable
          rows={data?.rows ?? []}
          columns={columns}
          searchPlaceholder="Search patient, record, or description…"
        />
      </Panel>
    </>
  );
}
