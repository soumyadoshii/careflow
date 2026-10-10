import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, ArrowUpDown, Eye, Pencil, Archive } from 'lucide-react';
import { Button, StatusBadge } from '../ui';

export interface TableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  mobileLabel?: string;
}

export interface TableFilter { key: string; label: string }

export function DataTable<T extends { id: string }>({
  rows, columns, searchPlaceholder = 'Search records…', emptyLabel = 'No records found.', filters = [],
  onView, onEdit, onArchive, rowActions,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  searchPlaceholder?: string;
  emptyLabel?: string;
  filters?: TableFilter[];
  onView?: (row: T) => void;
  onEdit?: (row: T) => void;
  onArchive?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
}) {
  const location = useLocation();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? 'id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 7;
  useEffect(() => { setQuery(new URLSearchParams(location.search).get('search') ?? ''); setPage(1); }, [location.search]);
  const statusValues = useMemo(() => Array.from(new Set(rows.map((row) => String((row as Record<string, unknown>).status ?? '')).filter(Boolean))), [rows]);
  const filterOptions = useMemo(() => filters.map((filter) => ({ ...filter, options: Array.from(new Set(rows.map((row) => String((row as Record<string, unknown>)[filter.key] ?? '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) })), [filters, rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = !query || Object.values(row as Record<string, unknown>).some((value) => String(value ?? '').toLowerCase().includes(query.toLowerCase()));
    const currentStatus = String((row as Record<string, unknown>).status ?? '');
    const matchesStatus = statusFilter === 'All statuses' || currentStatus === statusFilter;
    const matchesColumns = filterOptions.every((filter) => !columnFilters[filter.key] || String((row as Record<string, unknown>)[filter.key] ?? '') === columnFilters[filter.key]);
    return matchesQuery && matchesStatus && matchesColumns;
  }).sort((a, b) => {
    const av = String((a as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
    const bv = String((b as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
    const numericA = Number(av); const numericB = Number(bv);
    const comparison = Number.isFinite(numericA) && Number.isFinite(numericB) && av !== '' && bv !== '' ? numericA - numericB : av.localeCompare(bv, undefined, { numeric: true });
    return sortDirection === 'asc' ? comparison : -comparison;
  }), [rows, query, statusFilter, columnFilters, filterOptions, sortKey, sortDirection]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const changeSort = (key: string) => {
    setPage(1);
    if (sortKey === key) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('asc'); }
  };

  return <div className="table-wrap">
    <div className="table-toolbar">
      <label className="search-field"><Search size={16} /><input aria-label="Search table" placeholder={searchPlaceholder} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      <div className="table-toolbar-right">
        <span className="result-count">{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</span>
        {statusValues.length > 0 && <select className="filter-select" aria-label="Filter by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option>All statuses</option>{statusValues.map((status) => <option key={status}>{status}</option>)}</select>}
        {filterOptions.map((filter) => <select className="filter-select" aria-label={`Filter by ${filter.label}`} key={filter.key} value={columnFilters[filter.key] ?? ''} onChange={(event) => { setColumnFilters((current) => ({ ...current, [filter.key]: event.target.value })); setPage(1); }}><option value="">All {filter.label.toLowerCase()}</option>{filter.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>)}
      </div>
    </div>
    {visible.length === 0 ? <div className="table-empty">{emptyLabel}</div> : <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.key}><button className="th-sort" onClick={() => column.sortable === false ? undefined : changeSort(column.key)} disabled={column.sortable === false}>{column.label}{column.sortable !== false && <ArrowUpDown size={12} />}</button></th>)}{(onView || onEdit || onArchive || rowActions) && <th className="actions-heading">Actions</th>}</tr></thead><tbody>{visible.map((row) => <tr key={row.id}>{columns.map((column) => {
      const raw = (row as Record<string, unknown>)[column.key];
      return <td key={column.key} data-label={column.mobileLabel ?? column.label}>{column.render ? column.render(row) : column.key.toLowerCase().includes('status') ? <StatusBadge value={String(raw ?? '—')} /> : <span className={column.key === 'id' ? 'mono' : ''}>{String(raw ?? '—')}</span>}</td>;
    })}<td className="row-actions" data-label="Actions">{rowActions?.(row)}{onView && <Button variant="ghost" size="sm" aria-label="View record" title="View" onClick={() => onView(row)}><Eye size={15} /></Button>}{onEdit && <Button variant="ghost" size="sm" aria-label="Edit record" title="Edit" onClick={() => onEdit(row)}><Pencil size={15} /></Button>}{onArchive && <Button variant="ghost" size="sm" aria-label="Archive record" title="Archive" onClick={() => onArchive(row)}><Archive size={15} /></Button>}</td></tr>)}</tbody></table></div>}
    <div className="table-footer"><span>Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="sm" variant="secondary" aria-label="Previous page" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}><ChevronLeft size={15} />Previous</Button><span>Page {safePage} of {pageCount}</span><Button size="sm" variant="secondary" aria-label="Next page" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>Next<ChevronRight size={15} /></Button></div></div>
  </div>;
}
