import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Package, PackagePlus, Plus, Truck } from "lucide-react";
import type { Medicine, ProcurementOrder, Supplier } from "../../lib/api/types";
import { api } from "../../lib/api/api";
import {
  makeId,
  formatDate,
  formatMoney,
  moneyToPaise,
  paiseToRupees,
  lineAmountPaise,
  sumPaise,
} from "../../lib/format";
import { useToast } from "../../components/feedback/Toast";
import { DataTable, type TableColumn } from "../../components/data/DataTable";
import {
  EntityFormDialog,
  type EntityField,
} from "../../components/forms/EntityFormDialog";
import { CrudPage } from "../../components/data/CrudPage";
import { Button, PageHeader, Panel, StatusBadge } from "../../components/ui";

export function SuppliersPage() {
  const columns: TableColumn<never>[] = [
    { key: "name", label: "Supplier" },
    { key: "contact", label: "Contact person" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    {
      key: "leadDays",
      label: "Lead time",
      render: (row: never) => `${(row as unknown as Supplier).leadDays} days`,
    },
    { key: "status", label: "Status" },
  ];
  const fields: EntityField[] = [
    { name: "name", label: "Supplier name", required: true },
    { name: "contact", label: "Contact person", required: true },
    { name: "phone", label: "Phone", type: "tel", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    {
      name: "leadDays",
      label: "Lead time (days)",
      type: "number",
      required: true,
      min: 1,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: ["Active", "Inactive"].map((value) => ({ value, label: value })),
    },
  ];
  return (
    <CrudPage
      collection="suppliers"
      title="Suppliers"
      description="Maintain supplier contacts and link them to medicines and procurement."
      columns={columns as never}
      fields={fields}
      createLabel="Add supplier"
    />
  );
}

interface MedicineRow extends Medicine {
  supplierName: string;
  status: string;
}
const computeStockStatus = (medicine: Medicine): string => {
  if (!medicine.active) return "Inactive";
  const expiry = new Date(`${medicine.expiry}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expiry < today) return "Expired";
  if (medicine.stock === 0) return "Out of stock";
  if (medicine.stock <= medicine.minimumStock) return "Low stock";
  return "In stock";
};

export function InventoryPage() {
  const [rows, setRows] = useState<MedicineRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<MedicineRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState<MedicineRow | null>(null);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [medicines, supplierList] = await Promise.all([
      api.list("medicines"),
      api.list("suppliers"),
    ]);
    setSuppliers(supplierList);
    setRows(
      medicines.map((medicine) => ({
        ...medicine,
        supplierName:
          supplierList.find((item) => item.id === medicine.supplierId)?.name ??
          "Supplier not assigned",
        status: computeStockStatus(medicine),
      })),
    );
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const fields: EntityField[] = useMemo(
    () => [
      { name: "name", label: "Medicine name", required: true },
      {
        name: "form",
        label: "Dosage form",
        type: "select",
        required: true,
        options: [
          "Tablet",
          "Capsule",
          "Solution",
          "Syrup",
          "Cream",
          "Injection",
          "Other",
        ].map((value) => ({ value, label: value })),
      },
      { name: "strength", label: "Strength / pack size", required: true },
      {
        name: "stock",
        label: "Stock quantity",
        type: "number",
        required: true,
        min: 0,
        step: 1,
      },
      {
        name: "minimumStock",
        label: "Minimum stock level",
        type: "number",
        required: true,
        min: 0,
        step: 1,
      },
      { name: "expiry", label: "Expiry date", type: "date", required: true },
      {
        name: "supplierId",
        label: "Supplier",
        type: "select",
        required: true,
        options: suppliers
          .filter((item) => item.status === "Active")
          .map((item) => ({ value: item.id, label: item.name })),
      },
      {
        name: "unitPrice",
        label: "Unit cost (₹ INR)",
        type: "number",
        required: true,
        min: 0,
        step: 0.01,
      },
      {
        name: "active",
        label: "Catalog status",
        type: "select",
        required: true,
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
    ],
    [suppliers],
  );
  const stockFields: EntityField[] = [
    {
      name: "change",
      label: "Quantity adjustment",
      type: "number",
      required: true,
      step: 1,
      hint: "Use a positive number to receive stock, or a negative number for a correction.",
    },
    {
      name: "note",
      label: "Reason / reference",
      type: "textarea",
      required: true,
    },
  ];
  const columns: TableColumn<MedicineRow>[] = [
    {
      key: "name",
      label: "Medicine",
      render: (row) => (
        <div className="medicine-name">
          <strong>{row.name}</strong>
          <span>
            {row.strength} · {row.code}
          </span>
        </div>
      ),
    },
    { key: "form", label: "Form" },
    {
      key: "stock",
      label: "Stock qty",
      render: (row) => (
        <span className={row.stock <= row.minimumStock ? "stock-low" : ""}>
          {row.stock}
        </span>
      ),
    },
    { key: "minimumStock", label: "Min. level" },
    {
      key: "unitPrice",
      label: "Unit price (₹)",
      render: (row) => formatMoney(row.unitPrice),
    },
    { key: "expiry", label: "Expiry", render: (row) => formatDate(row.expiry) },
    { key: "supplierName", label: "Supplier" },
    {
      key: "status",
      label: "Stock status",
      render: (row) => <StatusBadge value={row.status} />,
    },
  ];
  const submitMedicine = async (values: Record<string, unknown>) => {
    const { status: _computed, supplierName: _supplierName, ...safe } = values;
    const payload = {
      ...safe,
      stock: Number(values.stock),
      minimumStock: Number(values.minimumStock),
      unitPrice: Number(values.unitPrice),
      active: values.active === "true" || values.active === true,
    };
    if (editing) await api.update("medicines", editing.id, payload as never);
    else
      await api.create("medicines", {
        ...payload,
        id: makeId("med"),
        code: `MED-${String(Date.now()).slice(-4)}`,
      } as never);
    setEditing(null);
    setCreating(false);
    await reload();
    showToast(
      editing
        ? "Medicine catalog record updated."
        : "Medicine added to the catalog.",
    );
  };
  const archiveMedicine = async (row: MedicineRow) => {
    if (!window.confirm(`Deactivate ${row.name} in the medicine catalog?`))
      return;
    try {
      await api.archive("medicines", row.id);
      await reload();
      showToast("Medicine deactivated; the catalog history is retained.");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to deactivate medicine.",
        "error",
      );
    }
  };
  const adjustStock = async (values: Record<string, unknown>) => {
    if (!adjusting) return;
    await api.adjustMedicineStock(
      adjusting.id,
      Number(values.change),
      String(values.note),
    );
    await reload();
    setAdjusting(null);
    showToast("Medicine stock adjusted and audit event recorded.");
  };
  const summary = {
    active: rows.filter((item) => item.active).length,
    low: rows.filter(
      (item) =>
        item.active && ["Low stock", "Out of stock"].includes(item.status),
    ).length,
    expired: rows.filter((item) => item.active && item.status === "Expired")
      .length,
    value: paiseToRupees(
      sumPaise(
        rows
          .filter((item) => item.active)
          .map((item) => moneyToPaise(item.unitPrice) * item.stock),      ),
    ),
  };
  return (
    <>
      <PageHeader
        eyebrow="Pharmacy & Inventory"
        title="Inventory & Medicine Management"
        subtitle="Manage the clinic medicine catalog, stock levels, expiry dates, and supplier links."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            Add medicine
          </Button>
        }
      />
      <div className="summary-strip panel">
        <span>
          Active catalog <strong>{summary.active}</strong>
        </span>
        <span>
          Low/out of stock <strong>{summary.low}</strong>
        </span>
        <span>
          Expired <strong>{summary.expired}</strong>
        </span>
        <span>
          Catalog value <strong>{formatMoney(summary.value)}</strong>
        </span>
      </div>
      <Panel
        title="Medicine catalog"
        subtitle="Create, view, edit, deactivate, search, filter and sort medicines."
        className="section-gap"
      >
        <DataTable
          rows={rows}
          columns={columns}
          filters={[
            { key: "form", label: "Dosage form" },
            { key: "supplierName", label: "Supplier" },
          ]}
          searchPlaceholder="Search medicine, code, form, supplier…"
          onView={(row) =>
            showToast(
              `${row.name} ${row.strength} · ${formatMoney(row.unitPrice)} unit price · stock ${row.stock} · minimum ${row.minimumStock} · expires ${formatDate(row.expiry)} · ${row.supplierName}`,
              "info",
            )
          }
          onEdit={(row) => setEditing(row)}
          onArchive={(row) => {
            void archiveMedicine(row);
          }}
          rowActions={(row) =>
            row.active ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdjusting(row)}
              >
                <PackagePlus size={13} />
                Adjust
              </Button>
            ) : null
          }
        />
      </Panel>
      <div className="callout warning section-gap">
        <Package size={16} />
        <div>
          <strong>Stock policy:</strong> low stock is at or below minimum level;
          out of stock is zero; expiry is evaluated against the current date.
          Dispensing reduces the available stock quantity.
        </div>
      </div>
      {(creating || editing) && (
        <EntityFormDialog
          title={editing ? "Edit medicine" : "Add medicine"}
          fields={fields}
          initial={
            editing
              ? (editing as unknown as Record<string, unknown>)
              : { stock: 0, minimumStock: 0, active: "true" }
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submitMedicine}
          submitLabel={editing ? "Save medicine" : "Add to catalog"}
        />
      )}
      {adjusting && (
        <EntityFormDialog
          title={`Adjust stock · ${adjusting.name}`}
          fields={stockFields}
          initial={{ change: 0, note: "" }}
          onClose={() => setAdjusting(null)}
          onSubmit={adjustStock}
          submitLabel="Apply adjustment"
        />
      )}
    </>
  );
}

interface ProcurementRow extends ProcurementOrder {
  supplierName: string;
  itemSummary: string;
}
export function ProcurementPage() {
  const [rows, setRows] = useState<ProcurementRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [editing, setEditing] = useState<ProcurementRow | null>(null);
  const [creating, setCreating] = useState(false);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [orders, supplierList, medicineList] = await Promise.all([
      api.list("procurement"),
      api.list("suppliers"),
      api.list("medicines"),
    ]);
    setSuppliers(supplierList);
    setMedicines(medicineList);
    setRows(
      orders.map((order) => ({
        ...order,
        supplierName:
          supplierList.find((item) => item.id === order.supplierId)?.name ??
          "Supplier",
        itemSummary: order.items
          .map(
            (line) =>
              `${medicineList.find((item) => item.id === line.medicineId)?.name ?? "Medicine"} × ${line.quantity}`,
          )
          .join(", "),
      })),
    );
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const fields: EntityField[] = useMemo(
    () => [
      {
        name: "supplierId",
        label: "Supplier",
        type: "select",
        required: true,
        options: suppliers
          .filter((item) => item.status === "Active")
          .map((item) => ({ value: item.id, label: item.name })),
      },
      {
        name: "medicineId",
        label: "Medicine",
        type: "select",
        required: true,
        options: medicines
          .filter((item) => item.active)
          .map((item) => ({
            value: item.id,
            label: `${item.name} · stock ${item.stock}`,
          })),
      },
      {
        name: "quantity",
        label: "Quantity",
        type: "number",
        required: true,
        min: 1,
        step: 1,
      },
      {
        name: "createdAt",
        label: "Request date",
        type: "date",
        required: true,
      },
      {
        name: "expectedAt",
        label: "Expected delivery",
        type: "date",
        required: true,
      },
    ],
    [suppliers, medicines],
  );
  const columns: TableColumn<ProcurementRow>[] = [
    { key: "id", label: "Order ID" },
    { key: "supplierName", label: "Supplier" },
    { key: "itemSummary", label: "Items" },
    {
      key: "createdAt",
      label: "Created",
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: "expectedAt",
      label: "Expected",
      render: (row) => formatDate(row.expectedAt),
    },
    {
      key: "total",
      label: "Estimated total",
      render: (row) => formatMoney(row.total),
    },
    { key: "status", label: "Status" },
  ];
  const save = async (values: Record<string, unknown>) => {
    const medicine = medicines.find(
      (item) => item.id === String(values.medicineId),
    );
    if (!medicine)
      throw new Error("Select a medicine from the active catalog.");
    const qty = Number(values.quantity);
    const payload = {
      supplierId: String(values.supplierId),
      createdAt: String(values.createdAt),
      expectedAt: String(values.expectedAt),
      status: editing?.status ?? ("Draft" as ProcurementOrder["status"]),
      total: paiseToRupees(lineAmountPaise(medicine.unitPrice, qty)),
      items: [{ medicineId: medicine.id, quantity: qty }],
    };
    if (editing) await api.update("procurement", editing.id, payload);
    else await api.create("procurement", { ...payload, id: makeId("po") });
    setCreating(false);
    setEditing(null);
    await reload();
    showToast(
      editing ? "Procurement order updated." : "Procurement order created.",
    );
  };
  const action = async (row: ProcurementRow, next: string) => {
    try {
      if (next === "Received") await api.receiveProcurement(row.id);
      else
        await api.update("procurement", row.id, {
          status: next as ProcurementOrder["status"],
        });
      await reload();
      showToast(
        next === "Received"
          ? "Order received; medicine stock was updated."
          : `Order ${next.toLowerCase()}.`,
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to update order.",
        "error",
      );
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Pharmacy & Inventory"
        title="Procurement"
        subtitle="Create and track purchase orders; receiving updates the linked medicine catalog."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New purchase order
          </Button>
        }
      />
      <Panel
        title="Purchase orders"
        subtitle={`${rows.length} purchase orders · supplier and medicine links are maintained`}
      >
        <DataTable
          rows={rows}
          columns={columns}
          filters={[{ key: "supplierName", label: "Supplier" }]}
          searchPlaceholder="Search order, supplier, medicine…"
          onView={(row) =>
            showToast(
              `${row.id}: ${row.itemSummary} · ${formatMoney(row.total)}`,
              "info",
            )
          }
          onEdit={(row) => {
            if (["Draft", "Submitted"].includes(row.status)) setEditing(row);
            else
              showToast(
                "Only draft or submitted purchase orders can be edited.",
                "info",
              );
          }}
          rowActions={(row) => (
            <div className="toolbar-line">
              {row.status === "Draft" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void action(row, "Submitted");
                  }}
                >
                  Submit
                </Button>
              )}
              {row.status === "Submitted" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void action(row, "Approved");
                  }}
                >
                  <Check size={13} />
                  Approve
                </Button>
              )}
              {row.status === "Approved" && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    void action(row, "Received");
                  }}
                >
                  <Truck size={13} />
                  Receive
                </Button>
              )}
              {["Draft", "Submitted"].includes(row.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void action(row, "Cancelled");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        />
      </Panel>
      {(creating || editing) && (
        <EntityFormDialog
          title={editing ? "Edit purchase order" : "New purchase order"}
          fields={fields}
          initial={
            editing
              ? {
                  supplierId: editing.supplierId,
                  medicineId: editing.items[0]?.medicineId,
                  quantity: editing.items[0]?.quantity,
                  createdAt: editing.createdAt,
                  expectedAt: editing.expectedAt,
                  status: editing.status,
                }
              : {
                  createdAt: new Date().toISOString().slice(0, 10),
                  status: "Draft",
                }
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={save}
          submitLabel={editing ? "Save order" : "Create order"}
        />
      )}
    </>
  );
}
