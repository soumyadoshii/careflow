import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, FlaskConical, Plus } from "lucide-react";
import { api } from "../../lib/api/api";
import type { LabOrder, Patient, Role } from "../../lib/api/types";
import { formatDate } from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import { CrudPage } from "../../components/data/CrudPage";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import {
  EntityFormDialog,
  type EntityField,
} from "../../components/forms/EntityFormDialog";
import { Button, PageHeader, Panel } from "../../components/ui";

const labStatuses = [
  "Ordered",
  "Collected",
  "Processing",
  "Completed",
  "Reviewed",
].map((value) => ({ value, label: value }));

export function LaboratoryWorklistPage({ role }: { role: Role }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  useEffect(() => {
    void api.list("patients").then(setPatients);
  }, []);
  const fields: EntityField[] = [
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
    { name: "test", label: "Test requested", required: true },
    { name: "orderedAt", label: "Order date", type: "date", required: true },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      required: true,
      options: ["Routine", "Urgent"].map((value) => ({ value, label: value })),
    },
    { name: "assignedTo", label: "Assigned technician", required: true },
    {
      name: "status",
      label: "Order status",
      type: "select",
      required: true,
      options: labStatuses,
    },
    { name: "referenceRange", label: "Reference range", required: true },
    { name: "result", label: "Result", type: "textarea" },
  ];
  const columns: TableColumn<never>[] = [
    { key: "id", label: "Order ID" },
    {
      key: "patientId",
      label: "Patient",
      render: (row: never) => {
        const order = row as unknown as LabOrder;
        const patient = patients.find((item) => item.id === order.patientId);
        return (
          <Link className="link-button" to={`/patients/${order.patientId}`}>
            {patient?.name ?? "Patient"}
          </Link>
        );
      },
    },
    { key: "test", label: "Test" },
    {
      key: "orderedAt",
      label: "Ordered",
      render: (row: never) =>
        formatDate((row as unknown as LabOrder).orderedAt),
    },
    { key: "priority", label: "Priority" },
    { key: "assignedTo", label: "Assigned to" },
    { key: "status", label: "Status" },
  ];
  return (
    <CrudPage
      collection="labOrders"
      title="Laboratory Worklist"
      description="Track specimen collection, processing, and review status across the lab."
      columns={columns as never}
      fields={fields}
      createLabel={role === "Doctor" ? "New lab order" : ""}
      allowEdit={false}
      allowArchive={false}
      filters={[{ key: "priority", label: "Priority" }]}
      rowActions={
        role === "Laboratory Technician"
          ? (row, reload) => {
              const order = row as unknown as LabOrder;
              const next: Record<string, LabOrder["status"]> = {
                Ordered: "Collected",
                Collected: "Processing",
                Processing: "Completed",
                Completed: "Reviewed",
              };
              const status =
                order.status === "Processing" ? undefined : next[order.status];
              return status ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void api
                      .update("labOrders", order.id, { status })
                      .then(reload);
                  }}
                >
                  <Check size={13} />
                  {status}
                </Button>
              ) : null;
            }
          : undefined
      }
    />
  );
}

export function LaboratoryResultsPage({
  role,
  patientId,
}: {
  role: Role;
  patientId?: string;
}) {
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [editing, setEditing] = useState<LabOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [labOrders, patientList] = await Promise.all([
      api.list("labOrders"),
      api.list("patients"),
    ]);
    const permitted =
      role === "Patient"
        ? labOrders.filter(
            (item) =>
              Boolean(patientId) &&
              item.patientId === patientId &&
              item.status === "Reviewed",
          )
        : labOrders;
    setOrders(permitted);
    setPatients(patientList);
  }, [role, patientId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const columns: TableColumn<LabOrder>[] = [
    { key: "id", label: "Order ID" },
    {
      key: "patientId",
      label: "Patient",
      render: (row) =>
        role === "Patient" ? (
          "My result"
        ) : (
          <Link className="link-button" to={`/patients/${row.patientId}`}>
            {patients.find((item) => item.id === row.patientId)?.name ??
              "Patient"}
          </Link>
        ),
    },
    { key: "test", label: "Test" },
    {
      key: "orderedAt",
      label: "Ordered",
      render: (row) => formatDate(row.orderedAt),
    },
    {
      key: "result",
      label: "Result",
      render: (row) =>
        row.result || <span className="activity-kicker">Awaiting result</span>,
    },
    { key: "status", label: "Status" },
  ];
  const submitResult = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !result.trim()) return;
    setSaving(true);
    try {
      await api.update("labOrders", editing.id, {
        result: result.trim(),
        status: "Completed",
      });
      await reload();
      setEditing(null);
      showToast("Laboratory result saved and marked complete.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to save result.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Laboratory Results"
        subtitle={
          role === "Patient"
            ? "Released test results linked to your profile."
            : "Enter, validate, and review laboratory results."
        }
        actions={
          role !== "Doctor" ? undefined : (
            <Button
              variant="secondary"
              onClick={() =>
                showToast(
                  "Create new test orders from the Laboratory Worklist.",
                  "info",
                )
              }
            >
              <Plus size={15} />
              New order
            </Button>
          )
        }
      />
      <Panel
        title={role === "Patient" ? "Released results" : "Results register"}
        subtitle={
          role === "Patient"
            ? "Only completed or reviewed results are shown."
            : `${orders.length} orders`
        }
      >
        <DataTable
          rows={orders}
          columns={columns}
          searchPlaceholder="Search test, patient, or order…"
          onView={(row) =>
            showToast(
              row.result
                ? `${row.test}: ${row.result} · ${row.referenceRange}`
                : "No result has been entered yet.",
              "info",
            )
          }
          rowActions={
            role !== "Laboratory Technician"
              ? undefined
              : (row) =>
                  ["Collected", "Processing"].includes(row.status) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(row);
                        setResult(row.result);
                      }}
                    >
                      <FlaskConical size={13} />
                      Enter result
                    </Button>
                  ) : row.status === "Completed" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void api
                          .update("labOrders", row.id, { status: "Reviewed" })
                          .then(reload)
                          .then(() => showToast("Result marked reviewed."));
                      }}
                    >
                      <Check size={13} />
                      Review
                    </Button>
                  ) : null
          }
        />
      </Panel>
      {editing && (
        <div className="modal-backdrop">
          <section className="modal-dialog" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <h2>Enter laboratory result</h2>
                <p>
                  {editing.id} · {editing.test} · reference:{" "}
                  {editing.referenceRange}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Close
              </Button>
            </div>
            <form className="entity-form" onSubmit={submitResult}>
              <label className="form-field">
                <span>
                  Result <span className="required-mark">*</span>
                </span>
                <textarea
                  rows={4}
                  required
                  value={result}
                  onChange={(event) => setResult(event.target.value)}
                  placeholder="Enter result and units"
                />
              </label>
              <div className="modal-actions">
                <Button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save result"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
