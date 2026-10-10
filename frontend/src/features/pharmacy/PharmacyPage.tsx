import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PackageCheck, Pill } from "lucide-react";
import { api } from "../../lib/api/api";
import type { Medicine, Patient, Prescription } from "../../lib/api/types";
import { formatDate } from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import { Button, PageHeader, Panel } from "../../components/ui";

interface DispenseRow extends Prescription {
  patientName: string;
  medicineSummary: string;
}
export function PharmacyPage() {
  const [rows, setRows] = useState<DispenseRow[]>([]);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [prescriptions, medicines, patients] = await Promise.all([
      api.list("prescriptions"),
      api.list("medicines"),
      api.list("patients"),
    ]);
    setRows(
      prescriptions.map((item) => ({
        ...item,
        patientName:
          patients.find((patient) => patient.id === item.patientId)?.name ??
          "Patient",
        medicineSummary: item.items
          .map(
            (line) =>
              `${medicines.find((medicine) => medicine.id === line.medicineId)?.name ?? "Medicine"} · ${line.quantity} units`,
          )
          .join("; "),
      })),
    );
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const columns: TableColumn<DispenseRow>[] = [
    { key: "id", label: "Prescription ID" },
    {
      key: "patientName",
      label: "Patient",
      render: (row) => (
        <Link className="link-button" to={`/patients/${row.patientId}`}>
          {row.patientName}
        </Link>
      ),
    },
    { key: "medicineSummary", label: "Medicine / quantity" },
    { key: "date", label: "Written", render: (row) => formatDate(row.date) },
    { key: "provider", label: "Prescriber" },
    { key: "status", label: "Status" },
  ];
  const dispense = async (row: DispenseRow) => {
    try {
      await api.dispensePrescription(row.id);
      await reload();
      showToast(`${row.id} dispensed; inventory was deducted.`);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to dispense this prescription.",
        "error",
      );
    }
  };
  const ready = rows.filter((row) =>
    ["Pending", "Ready for Pickup"].includes(row.status),
  ).length;
  return (
    <>
      <PageHeader
        eyebrow="Pharmacy & Inventory"
        title="Pharmacy"
        subtitle="Fulfill prescriptions with stock-aware dispensing and traceable inventory updates."
      />
      <div className="summary-strip panel">
        <span>
          Dispensing queue <strong>{ready}</strong>
        </span>
        <span>
          Open prescriptions{" "}
          <strong>
            {
              rows.filter(
                (row) =>
                  row.status !== "Dispensed" && row.status !== "Cancelled",
              ).length
            }
          </strong>
        </span>
        <span>
          Workflow <strong>Prescription → dispense → stock deduction</strong>
        </span>
      </div>
      <Panel
        title="Prescription dispensing queue"
        subtitle="Dispensing checks available medicine quantities before committing stock changes."
        className="section-gap"
      >
        <DataTable
          rows={rows}
          columns={columns}
          searchPlaceholder="Search patient, prescription, or medicine…"
          onView={(row) =>
            showToast(`${row.id}: ${row.medicineSummary}`, "info")
          }
          rowActions={(row) =>
            row.status !== "Dispensed" && row.status !== "Cancelled" ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void dispense(row);
                }}
              >
                <PackageCheck size={13} />
                Dispense
              </Button>
            ) : (
              <span className="activity-kicker">
                <Pill size={13} />
                Fulfilled
              </span>
            )
          }
        />
      </Panel>
      <div className="callout section-gap">
        <Pill size={16} />
        <div>
          <strong>Clinical workflow only.</strong> This prescription-dispensing
          module is not a shopping cart or e-commerce checkout. Successful
          fulfillment updates relational medicine stock and appends an audit
          event.
        </div>
      </div>
    </>
  );
}
