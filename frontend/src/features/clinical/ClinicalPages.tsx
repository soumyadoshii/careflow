import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ClipboardList, Pill, Plus } from "lucide-react";
import { api } from "../../lib/api/api";
import type { AnyEntity } from "../../components/data/CrudPage";
import type {
  Consultation,
  Medicine,
  Patient,
  Prescription,
  Role,
} from "../../lib/api/types";
import { formatDate, formatMoney, makeId } from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import { CrudPage } from "../../components/data/CrudPage";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import {
  EntityFormDialog,
  type EntityField,
} from "../../components/forms/EntityFormDialog";
import { Button, PageHeader, Panel, StatusBadge } from "../../components/ui";

export function ConsultationsPage({
  role = "Clinic Administrator",
  providerName = "Dr. Omar Hassan",
}: {
  role?: Role;
  providerName?: string;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  useEffect(() => {
    void api.list("patients").then(setPatients);
  }, []);
  const fields: EntityField[] = [
    { name: "appointmentId", label: "Appointment ID", required: true },
    {
      name: "patientId",
      label: "Patient",
      type: "select",
      required: true,
      options: patients.map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.mrn}`,
      })),
    },
    {
      name: "provider",
      label: "Provider",
      type: "select",
      required: true,
      options: (role === "Doctor"
        ? [providerName]
        : ["Dr. Omar Hassan", "Dr. Elise Carter", "Dr. Mei Tan"]
      ).map((value) => ({ value, label: value })),
    },
    { name: "reason", label: "Visit reason", required: true },
    {
      name: "notes",
      label: "Consultation notes",
      type: "textarea",
      required: true,
    },
    { name: "date", label: "Visit date", type: "date", required: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: ["Waiting", "In Progress", "Completed"].map((value) => ({
        value,
        label: value,
      })),
    },
  ];
  const columns: TableColumn<never>[] = [
    { key: "id", label: "Visit ID" },
    {
      key: "patientId",
      label: "Patient",
      render: (row: never) => {
        const visit = row as unknown as Consultation;
        const patient = patients.find((item) => item.id === visit.patientId);
        return (
          <Link className="link-button" to={`/patients/${visit.patientId}`}>
            {patient?.name ?? "Patient"}
          </Link>
        );
      },
    },
    { key: "reason", label: "Reason" },
    { key: "provider", label: "Provider" },
    {
      key: "date",
      label: "Date",
      render: (row: never) => formatDate((row as unknown as Consultation).date),
    },
    { key: "status", label: "Status" },
  ];
  return (
    <CrudPage
      collection="consultations"
      title="Consultations"
      description="Manage the visit queue, record consultation notes, and update consultation status."
      columns={columns as never}
      fields={fields}
      createLabel={role === "Doctor" ? "Add consultation" : ""}
      allowEdit={role === "Doctor"}
      allowArchive={false}
      rowActions={
        role === "Doctor"
          ? (row, reload) => {
              const visit = row as unknown as Consultation;
              const next: Consultation["status"] =
                visit.status === "Waiting" ? "In Progress" : "Completed";
              return visit.status !== "Completed" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void api
                      .update("consultations", visit.id, { status: next })
                      .then(reload);
                  }}
                >
                  <Check size={13} />
                  {visit.status === "Waiting" ? "Start" : "Complete"}
                </Button>
              ) : null;
            }
          : undefined
      }
    />
  );
}

interface PrescriptionRow extends Prescription {
  patientName: string;
  medicineSummary: string;
}
export function PrescriptionsPage({
  role,
  patientId,
  providerName = "Dr. Omar Hassan",
}: {
  role: Role;
  patientId?: string;
  providerName?: string;
}) {
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [editing, setEditing] = useState<Prescription | null>(null);
  const [creating, setCreating] = useState(false);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [prescriptions, medicineList, patientList] = await Promise.all([
      api.list("prescriptions"),
      role === "Patient" ? Promise.resolve([]) : api.list("medicines"),
      api.list("patients"),
    ]);
    setMedicines(medicineList);
    setPatients(patientList);
    const enriched = prescriptions.map((item) => ({
      ...item,
      patientName:
        patientList.find((patient) => patient.id === item.patientId)?.name ??
        "Patient",
      medicineSummary: item.items
        .map(
          (line) =>
            `${line.medicineName ?? medicineList.find((medicine) => medicine.id === line.medicineId)?.name ?? "Medicine"}${line.medicineStrength ? ` ${line.medicineStrength}` : ""} · ${line.quantity} units`,
        )
        .join("; "),
    }));
    const permitted =
      role === "Patient"
        ? patientId
          ? enriched.filter((item) => item.patientId === patientId)
          : []
        : enriched;
    setRows(permitted);
  }, [role, patientId, providerName]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const fields: EntityField[] =
    role === "Pharmacist"
      ? [
          {
            name: "status",
            label: "Pickup status",
            type: "select",
            required: true,
            options: (editing?.status === "Pending"
              ? ["Ready for Pickup", "Cancelled"]
              : ["Cancelled"]
            ).map((value) => ({ value, label: value })),
          },
        ]
      : [
          {
            name: "patientId",
            label: "Patient",
            type: "select",
            required: true,
            options: patients.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.mrn}`,
            })),
          },
          {
            name: "provider",
            label: "Prescribing clinician",
            type: role === "Doctor" ? "select" : "text",
            required: true,
            ...(role === "Doctor"
              ? { options: [{ value: providerName, label: providerName }] }
              : {}),
          },
          { name: "date", label: "Date", type: "date", required: true },
          {
            name: "medicineId",
            label: "Medicine",
            type: "select",
            required: true,
            options: medicines
              .filter((item) => item.active)
              .map((item) => ({
                value: item.id,
                label: `${item.name} ${item.strength} · stock ${item.stock}`,
              })),
          },
          {
            name: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
            min: 1,
          },
          { name: "dose", label: "Dose", required: true },
          {
            name: "instructions",
            label: "Instructions",
            type: "textarea",
            required: true,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            required: true,
            options: ["Pending", "Cancelled"].map((value) => ({
              value,
              label: value,
            })),
          },
        ];
  const submit = async (values: Record<string, unknown>) => {
    const current = editing;
    const line = {
      medicineId: String(values.medicineId),
      quantity: Number(values.quantity),
      dose: String(values.dose),
      instructions: String(values.instructions),
    };
    if (current && role === "Pharmacist")
      await api.update("prescriptions", current.id, {
        status: values.status as Prescription["status"],
      });
    else if (current)
      await api.update("prescriptions", current.id, {
        date: String(values.date),
        status: values.status as Prescription["status"],
        items: [line],
      });
    else
      await api.create("prescriptions", {
        id: makeId("rx"),
        patientId: String(values.patientId),
        provider: String(values.provider),
        date: String(values.date),
        status: values.status as Prescription["status"],
        items: [line],
      });
    setEditing(null);
    setCreating(false);
    await reload();
    showToast(current ? "Prescription updated." : "Prescription created.");
  };
  const columns: TableColumn<PrescriptionRow>[] = [
    { key: "id", label: "Prescription" },
    {
      key: "patientName",
      label: "Patient",
      render: (row) =>
        role === "Patient" ? (
          "My record"
        ) : (
          <Link className="link-button" to={`/patients/${row.patientId}`}>
            {row.patientName}
          </Link>
        ),
    },
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    { key: "medicineSummary", label: "Medicine / quantity" },
    { key: "provider", label: "Prescriber" },
    { key: "status", label: "Status" },
  ];
  const dispense = async (row: PrescriptionRow) => {
    try {
      await api.dispensePrescription(row.id);
      await reload();
      showToast("Prescription dispensed and inventory quantities deducted.");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to dispense prescription.",
        "error",
      );
    }
  };
  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle={
          role === "Patient"
            ? "Your prescription history and pickup status."
            : "Review prescriptions and hand off to pharmacy dispensing."
        }
        actions={
          role !== "Doctor" ? undefined : (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              New prescription
            </Button>
          )
        }
      />
      <Panel
        title={
          role === "Patient" ? "My prescriptions" : "Prescription register"
        }
        subtitle={`${rows.length} prescriptions`}
      >
        <DataTable
          rows={rows}
          columns={columns}
          searchPlaceholder="Search prescription, patient, or medicine…"
          onView={(row) =>
            showToast(`${row.id}: ${row.medicineSummary}`, "info")
          }
          onEdit={undefined}
          onArchive={undefined}
          rowActions={(row) => {
            if (role === "Doctor" && row.status === "Pending")
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(row)}
                >
                  Edit prescription
                </Button>
              );
            if (role === "Pharmacist" && row.status === "Pending")
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(row)}
                >
                  Set pickup status
                </Button>
              );
            if (role === "Doctor" && row.status === "Ready for Pickup")
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await api.update("prescriptions", row.id, {
                        status: "Cancelled",
                      });
                      await reload();
                      showToast("Prescription cancelled.");
                    } catch (error) {
                      showToast(
                        error instanceof Error
                          ? error.message
                          : "Unable to cancel prescription.",
                        "error",
                      );
                    }
                  }}
                >
                  Cancel
                </Button>
              );
            if (role === "Pharmacist" && row.status === "Ready for Pickup")
              return (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing(row)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void dispense(row);
                    }}
                  >
                    <Pill size={13} />
                    Dispense
                  </Button>
                </>
              );
            return null;
          }}
        />
      </Panel>
      {(creating || editing) && (
        <EntityFormDialog
          title={editing ? "Edit prescription" : "New prescription"}
          fields={fields}
          initial={
            editing
              ? {
                  ...editing,
                  medicineId: editing.items[0]?.medicineId,
                  dose: editing.items[0]?.dose,
                  quantity: editing.items[0]?.quantity,
                  instructions: editing.items[0]?.instructions,
                }
              : {
                  date: new Date().toISOString().slice(0, 10),
                  status: "Pending",
                  provider: role === "Doctor" ? providerName : "",
                }
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
          submitLabel={editing ? "Save prescription" : "Create prescription"}
        />
      )}
    </>
  );
}
