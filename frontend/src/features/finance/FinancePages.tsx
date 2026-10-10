import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  Plus,
  Printer,
  Receipt,
  Users,
} from "lucide-react";
import { api } from "../../lib/api/api";
import type { Invoice, Patient, Role } from "../../lib/api/types";
import type {
  ReportKind,
  ReportRequest,
  ReportRow,
} from "../../lib/reports/types";
import {
  formatDate,
  formatMoney,
  makeId,
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
import {
  Button,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from "../../components/ui";

interface InvoiceRow extends Invoice {
  patientName: string;
  balance: number;
}
export function BillingPage({
  role,
  patientId,
}: {
  role: Role;
  patientId?: string;
}) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    const [invoices, patientList] = await Promise.all([
      api.list("invoices"),
      api.list("patients"),
    ]);
    setPatients(patientList);
    const enriched = invoices.map((invoice) => ({
      ...invoice,
      patientName:
        patientList.find((patient) => patient.id === invoice.patientId)?.name ??
        "Patient",
      balance: paiseToRupees(
        moneyToPaise(invoice.total) - moneyToPaise(invoice.paid),
      ),
    }));
    setRows(
      role === "Patient"
        ? enriched.filter(
            (invoice) => Boolean(patientId) && invoice.patientId === patientId,
          )
        : enriched,
    );
  }, [role, patientId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const fields: EntityField[] = useMemo(
    () => [
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
      { name: "issuedAt", label: "Issue date", type: "date", required: true },
      { name: "dueAt", label: "Due date", type: "date", required: true },
      { name: "description", label: "Invoice description", required: true },
      ...(editing
        ? []
        : [
            {
              name: "total",
              label: "Total (INR)",
              type: "number" as const,
              required: true,
              min: 0.01,
              step: 0.01,
            },
          ]),
    ],
    [patients, editing],
  );
  const columns: TableColumn<InvoiceRow>[] = [
    { key: "id", label: "Invoice" },
    {
      key: "patientName",
      label: "Patient",
      render: (row) =>
        role === "Patient" ? (
          "My invoice"
        ) : (
          <Link className="link-button" to={`/patients/${row.patientId}`}>
            {row.patientName}
          </Link>
        ),
    },
    {
      key: "issuedAt",
      label: "Issued",
      render: (row) => formatDate(row.issuedAt),
    },
    { key: "description", label: "Description" },
   {
  key: "items",
  label: "Bill items",
  render: (row) => (
    <div>
      {(row.items ?? []).map((item, index) => (
        <div key={`${row.id}-line-${index}`}>
          {item.description} × {item.quantity}:{" "}
          {formatMoney(
            paiseToRupees(lineAmountPaise(item.unitPrice, item.quantity)),
          )}
        </div>
      ))}
    </div>
  ),
},
{
  key: "total",
  label: "Total",
  render: (row) => formatMoney(row.total),
},
{
  key: "paid",
  label: "Paid",
  render: (row) => formatMoney(row.paid),
},
{
  key: "balance",
  label: "Balance",
  render: (row) => formatMoney(row.balance),
},
{
  key: "status",
  label: "Status",
},
    { key: "total", label: "Total", render: (row) => formatMoney(row.total) },
    { key: "paid", label: "Paid", render: (row) => formatMoney(row.paid) },
    {
      key: "balance",
      label: "Balance",
      render: (row) => formatMoney(row.balance),
    },
    { key: "status", label: "Status" },
  ];
  const save = async (values: Record<string, unknown>) => {
    const description = String(values.description);
    if (editing)
      await api.update("invoices", editing.id, {
        dueAt: String(values.dueAt),
        description,
      });
    else {
      const totalPaise = moneyToPaise(String(values.total));
      if (totalPaise <= 0)
        throw new Error("Invoice total must be greater than zero.");
      await api.create("invoices", {
        id: makeId("inv"),
        patientId: String(values.patientId),
        issuedAt: String(values.issuedAt),
        dueAt: String(values.dueAt),
        description,
        items: [
          { description, quantity: 1, unitPrice: paiseToRupees(totalPaise) },
        ],
      } as any);
    }
    setCreating(false);
    setEditing(null);
    await reload();
    showToast(editing ? "Invoice updated." : "Invoice created.");
  };
  const markPaid = async (row: InvoiceRow) => {
    try {
      await api.setInvoicePayment(row.id, row.total);
      await reload();
      showToast(`${row.id} marked paid.`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to update invoice.",
        "error",
      );
    }
  };
  const totalDue = paiseToRupees(
    sumPaise(rows.map((row) => moneyToPaise(row.balance))),
  );
  return (
    <>
      <PageHeader
        title="Billing"
        subtitle={
          role === "Patient"
            ? "Invoices linked to your patient profile."
            : "Create invoices and record invoice payments through the clinic billing workflow."
        }
        actions={
          role === "Patient" ? undefined : (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              Create invoice
            </Button>
          )
        }
      />
      <div className="metric-grid">
        <Metric
          label="Invoices"
          value={rows.length}
          detail="Visible records"
          icon={<Receipt size={16} />}
        />
        <Metric
          label="Outstanding balance"
          value={formatMoney(totalDue)}
          detail="Across displayed invoices"
          icon={<CircleDollarSign size={16} />}
        />
        <Metric
          label="Paid invoices"
          value={rows.filter((row) => row.status === "Paid").length}
          detail="Status recorded"
          icon={<Receipt size={16} />}
        />
        <Metric
          label="Pending payment"
          value={
            rows.filter(
              (row) => row.status === "Unpaid" || row.status === "Part Paid",
            ).length
          }
          detail="Unpaid or part-paid"
          icon={<CircleDollarSign size={16} />}
        />
      </div>
      <Panel
        title={role === "Patient" ? "My invoices" : "Invoice register"}
        subtitle={
          role === "Patient"
            ? "Patient-scoped invoice and payment information."
            : "Billing workflows are available to Clinic Administrator and Receptionist roles."
        }
      >
        <DataTable
          rows={rows}
          columns={columns}
          searchPlaceholder="Search invoice, patient, or description…"
          onView={(row) =>
            showToast(
              `${row.id} · ${formatMoney(row.total)} total · ${formatMoney(row.balance)} balance`,
              "info",
            )
          }
          onEdit={role === "Patient" ? undefined : (row) => setEditing(row)}
          onArchive={
            role === "Patient"
              ? undefined
              : async (row) => {
                  if (window.confirm(`Void invoice ${row.id}?`)) {
                    await api.update("invoices", row.id, { status: "Void" });
                    await reload();
                    showToast("Invoice voided.");
                  }
                }
          }
          rowActions={
            role === "Patient"
              ? undefined
              : (row) =>
                  row.status !== "Paid" && row.status !== "Void" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void markPaid(row);
                      }}
                    >
                      Mark paid
                    </Button>
                  ) : null
          }
        />
      </Panel>
      {(creating || editing) && (
        <EntityFormDialog
          title={editing ? "Edit invoice" : "Create invoice"}
          fields={fields}
          initial={
            editing
              ? (editing as unknown as Record<string, unknown>)
              : {
                  issuedAt: new Date().toISOString().slice(0, 10),
                  dueAt: "",
                  total: 0,
                }
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={save}
          submitLabel={editing ? "Save invoice" : "Create invoice"}
        />
      )}
    </>
  );
}

interface ReportDisplayRow extends ReportRow {
  id: string;
}
function ReportPage({ kind }: { kind: ReportKind }) {
  const { showToast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<ReportRequest>({
    from: "2026-10-01",
    to: today,
  });
  const [rows, setRows] = useState<ReportDisplayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<{
    invoices: Invoice[];
    patients: Patient[];
  } | null>(null);
  const financial = kind === "financial";
  const title = financial ? "Financial Reports" : "Operational Reports";
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [report, snapshot] = await Promise.all([
        api.reports.data(kind, range),
        api.getSnapshot(),
      ]);
      setRows(
        report.map((item, index) => ({ ...item, id: `${kind}-${index + 1}` })),
      );
      setRaw({
        invoices: snapshot.invoices.filter(
          (item) =>
            (!range.from || item.issuedAt >= range.from) &&
            (!range.to || item.issuedAt <= range.to),
        ),
        patients: snapshot.patients,
      });
    } catch {
      showToast("Unable to load report data.", "error");
    } finally {
      setLoading(false);
    }
  }, [kind, range, showToast]);
  useEffect(() => {
    void load();
  }, [load]);
  const chartRows = useMemo(() => {
    if (financial) {
      const groups = new Map<string, number>();
      (raw?.invoices ?? []).forEach((invoice) => {
        const key = invoice.issuedAt.slice(0, 7);
        groups.set(
          key,
          sumPaise([groups.get(key) ?? 0, moneyToPaise(invoice.paid)]),
        );
      });
      return Array.from(groups.entries()).map(([month, value]) => ({
        label: month,
        value: paiseToRupees(value),
      }));
    }
    return rows.map((row) => ({
      label: String(row.Area ?? ""),
      value: Number(row["Records in period"] ?? 0),
    }));
  }, [financial, raw, rows]);
  const totalRevenue = paiseToRupees(
    sumPaise(raw?.invoices.map((item) => moneyToPaise(item.total)) ?? []),
  );
  const paidRevenue = paiseToRupees(
    sumPaise(raw?.invoices.map((item) => moneyToPaise(item.paid)) ?? []),
  );
  const generate = async (format: "pdf" | "xlsx") => {
    try {
      const blob = await api.reports.file(kind, format, range);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `careflow-${kind}-${range.from || "all"}-to-${range.to || "today"}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1500);
      showToast(
        format === "pdf"
          ? "PDF report generated."
          : "Excel workbook exported from current report data.",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to generate report file.",
        "error",
      );
    }
  };
  const print = () => {
    window.print();
    showToast("Print view is ready. Choose a printer or Save as PDF.");
  };
  const columns: TableColumn<ReportDisplayRow>[] = rows[0]
    ? Object.keys(rows[0])
        .filter((key) => key !== "id")
        .map((key) => ({
          key,
          label: key,
          render: (row) => String(row[key] ?? "—"),
        }))
    : [];
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          financial
            ? "Review revenue and billing activity from clinic invoices."
            : "Review patient, appointment, laboratory, pharmacy, and inventory activity."
        }
      />
      <div className="panel report-toolbar report-no-print">
        <div className="report-date-range">
          <label className="form-field">
            <span>From</span>
            <input
              type="date"
              value={range.from}
              onChange={(event) =>
                setRange((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>To</span>
            <input
              type="date"
              value={range.to}
              onChange={(event) =>
                setRange((current) => ({ ...current, to: event.target.value }))
              }
            />
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              void load();
            }}
          >
            Apply dates
          </Button>
        </div>
        <div className="report-actions">
          <Button
            variant="primary"
            onClick={() => {
              void generate("pdf");
            }}
          >
            <FileDown size={14} />
            Generate PDF
          </Button>
          <Button
            onClick={() => {
              void generate("xlsx");
            }}
          >
            <FileSpreadsheet size={14} />
            Export Excel
          </Button>
          <Button onClick={print}>
            <Printer size={14} />
            Print
          </Button>
        </div>
      </div>
      <div className="report-print-header">
        <h1>Careflow Clinic ERP · {title}</h1>
        <p>
          Reporting period: {range.from ? formatDate(range.from) : "All dates"}{" "}
          – {range.to ? formatDate(range.to) : "Today"} · Clinic records
        </p>
      </div>
      <div className="metric-grid section-gap">
        {financial ? (
          <>
            <Metric
              label="Invoice total"
              value={formatMoney(totalRevenue)}
              detail="Within selected period"
              icon={<Receipt size={16} />}
            />
            <Metric
              label="Payments recorded"
              value={formatMoney(paidRevenue)}
              detail="Billing ledger"
              icon={<CircleDollarSign size={16} />}
            />
            <Metric
              label="Invoices"
              value={raw?.invoices.length ?? 0}
              detail="Within selected period"
              icon={<FileSpreadsheet size={16} />}
            />
            <Metric
              label="Outstanding"
              value={formatMoney(
                paiseToRupees(
                  moneyToPaise(totalRevenue) - moneyToPaise(paidRevenue),
                ),
              )}
              detail="Unpaid and part-paid"
              icon={<CircleDollarSign size={16} />}
            />
          </>
        ) : (
          <>
            <Metric
              label="Report categories"
              value={rows.length}
              detail="Operational indicators"
              icon={<FileSpreadsheet size={16} />}
            />
            <Metric
              label="Appointments"
              value={
                rows.find((row) => row.Area === "Appointments")?.[
                  "Records in period"
                ] ?? 0
              }
              detail="In selected period"
              icon={<CalendarDays size={16} />}
            />
            <Metric
              label="Lab orders"
              value={
                rows.find((row) => row.Area === "Laboratory orders")?.[
                  "Records in period"
                ] ?? 0
              }
              detail="In selected period"
              icon={<ClipboardList size={16} />}
            />
            <Metric
              label="New patients"
              value={
                rows.find((row) => row.Area === "Patient registrations")?.[
                  "Records in period"
                ] ?? 0
              }
              detail="In selected period"
              icon={<Users size={16} />}
            />
          </>
        )}
      </div>
      <div className="content-grid two section-gap">
        <Panel
          title={financial ? "Payments by month" : "Activity by area"}
          subtitle={
            financial
              ? "Recorded payments within the selected dates"
              : "Records and status snapshots from clinic workflows"
          }
        >
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                margin={{ top: 5, right: 10, left: -10, bottom: 30 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#e6ebf1"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: "#718096" }}
                  angle={financial ? 0 : -15}
                  textAnchor={financial ? "middle" : "end"}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#718096" }}
                  tickFormatter={(value: number) =>
                    financial ? `₹${Math.round(value / 1000)}k` : String(value)
                  }
                />
                <Tooltip
                  formatter={(value) =>
                    financial ? formatMoney(Number(value)) : Number(value)
                  }
                  contentStyle={{
                    border: "1px solid #dce3ec",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="value"
                  name={financial ? "Payments" : "Records"}
                  fill="#2563eb"
                  radius={[2, 2, 0, 0]}
                  barSize={financial ? 38 : 24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Report notes" subtitle="Scope and interpretation">
          <ul className="activity-list">
            <li className="activity-row">
              <span className="activity-dot" />
              <div className="activity-copy">
                <strong>Data source</strong>
                <span>Figures are based on clinic records.</span>
              </div>
            </li>
            <li className="activity-row">
              <span className="activity-dot" />
              <div className="activity-copy">
                <strong>Selected range</strong>
                <span>
                  {range.from ? formatDate(range.from) : "All dates"} –{" "}
                  {range.to ? formatDate(range.to) : "Today"}
                </span>
              </div>
            </li>
            <li className="activity-row">
              <span className="activity-dot" />
              <div className="activity-copy">
                <strong>Export behavior</strong>
                <span>
                  PDF, Excel, and print output use the active reporting period.
                </span>
              </div>
            </li>
          </ul>
        </Panel>
      </div>
      <Panel
        title={financial ? "Invoice detail" : "Operational indicators"}
        subtitle={
          loading
            ? "Refreshing report…"
            : `${rows.length} report rows · current date filters applied`
        }
        className="section-gap"
      >
        <DataTable
          rows={rows}
          columns={columns}
          searchPlaceholder="Search report rows…"
          emptyLabel="No report rows match the selected period."
        />
      </Panel>
    </>
  );
}

export function FinancialReportsPage() {
  return <ReportPage kind="financial" />;
}
export function OperationalReportsPage() {
  return <ReportPage kind="operational" />;
}
