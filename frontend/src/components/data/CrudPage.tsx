import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../lib/api/api";
import type { CollectionName, EntityMap } from "../../lib/api/types";
import { Button, PageHeader } from "../ui";
import { DataTable, type TableColumn, type TableFilter } from "./DataTable";
import { EntityFormDialog, type EntityField } from "../forms/EntityFormDialog";
import { useToast } from "../feedback/Toast";

export type AnyEntity = EntityMap[CollectionName] & { id: string };
type CrudColumn = TableColumn<AnyEntity>;

export function CrudPage({
  collection,
  title,
  description,
  columns,
  fields,
  createLabel = "Add record",
  createFields,
  allowEdit = true,
  allowArchive = true,
  pageActions,
  filterRows,
  filters,
  rowActions,
}: {
  collection: CollectionName;
  title: string;
  description: string;
  columns: CrudColumn[];
  fields: EntityField[];
  createLabel?: string;
  createFields?: EntityField[];
  allowEdit?: boolean;
  allowArchive?: boolean;
  pageActions?: React.ReactNode;
  filterRows?: (rows: AnyEntity[]) => AnyEntity[];
  filters?: TableFilter[];
  rowActions?: (row: AnyEntity, reload: () => void) => React.ReactNode;
}) {
  const [records, setRecords] = useState<AnyEntity[]>([]);
  const [editing, setEditing] = useState<AnyEntity | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<AnyEntity | null>(null);
  const [busy, setBusy] = useState(true);
  const { showToast } = useToast();
  const reload = useCallback(async () => {
    setBusy(true);
    try {
      setRecords((await api.list(collection)) as AnyEntity[]);
    } catch {
      showToast(`Unable to load ${title.toLowerCase()}.`, "error");
    } finally {
      setBusy(false);
    }
  }, [collection, title, showToast]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = useMemo(
    () => (filterRows ? filterRows(records) : records),
    [filterRows, records],
  );
  const modalFields = editing ? fields : (createFields ?? fields);

  const save = async (values: Record<string, unknown>) => {
    const sanitized = { ...values } as Record<string, unknown>;
    if (collection === "medicines" && !sanitized.code)
      sanitized.code = `MED-${Math.floor(1000 + Math.random() * 8999)}`;
    if (collection === "users" && !sanitized.lastActive)
      sanitized.lastActive = "Not yet active";
    if (collection === "patients") {
      if (!sanitized.mrn)
        sanitized.mrn = `CF-${Math.floor(1000 + Math.random() * 8999)}`;
      if (!sanitized.registeredAt)
        sanitized.registeredAt = new Date().toISOString().slice(0, 10);
      if (!sanitized.lastVisit) sanitized.lastVisit = "—";
    }
    if (editing) await api.update(collection, editing.id, sanitized as never);
    else await api.create(collection, sanitized as never);
    await reload();
    showToast(`${title.replace(/s$/, "")} ${editing ? "updated" : "created"}.`);
    setEditing(null);
    setCreating(false);
  };

  const archiveRecord = async (row: AnyEntity) => {
    const record = row as unknown as Record<string, unknown>;
    const label = String(record.name ?? record.id);
    if (!window.confirm(`Archive or deactivate ${label}?`)) return;
    try {
      await api.archive(collection, row.id);
      await reload();
      showToast("Record archived or deactivated.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to archive record.",
        "error",
      );
    }
  };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={description}
        actions={
          <>
            {pageActions}
            {createLabel && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={15} />
                {createLabel}
              </Button>
            )}
          </>
        }
      />
      <section className="panel">
        <div className="summary-strip">
          {busy ? (
            <span>Loading records…</span>
          ) : (
            <>
              <span>
                Records <strong>{visible.length}</strong>
              </span>
              <span>
                Last refreshed <strong>just now</strong>
              </span>
            </>
          )}
        </div>
        <DataTable
          rows={visible}
          columns={columns}
          filters={filters}
          onView={setViewing}
          onEdit={allowEdit ? setEditing : undefined}
          onArchive={
            allowArchive
              ? (row) => {
                  void archiveRecord(row);
                }
              : undefined
          }
          rowActions={
            rowActions
              ? (row) =>
                  rowActions(row, () => {
                    void reload();
                  })
              : undefined
          }
        />
      </section>
      {(creating || editing) && (
        <EntityFormDialog
          title={`${editing ? "Edit" : "Add"} ${title.replace(/s$/, "")}`}
          fields={modalFields}
          initial={(editing as unknown as Record<string, unknown>) ?? {}}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={save}
          submitLabel={editing ? "Save changes" : "Create record"}
        />
      )}
      {viewing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setViewing(null);
          }}
        >
          <section className="modal-dialog" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <h2>{title.replace(/s$/, "")} details</h2>
                <p>Record · {viewing.id}</p>
              </div>
              <Button variant="ghost" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
            <div className="detail-grid">
              {Object.entries(
                viewing as unknown as Record<string, unknown>,
              ).map(([key, value]) => (
                <div className="detail-item" key={key}>
                  <span>
                    {key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (character) => character.toUpperCase())}
                  </span>
                  <strong>
                    {Array.isArray(value)
                      ? `${value.length} items`
                      : String(value ?? "—")}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
