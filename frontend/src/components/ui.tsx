import type { ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, AlertTriangle, XCircle } from 'lucide-react';

export function Button({ children, variant = 'secondary', size = 'md', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; children: ReactNode }) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`} {...props}>{children}</button>;
}

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: string; subtitle?: string; eyebrow?: string; actions?: ReactNode }) {
  return <div className="page-heading">
    <div className="page-heading-copy">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="page-heading-actions">{actions}</div>}
  </div>;
}

export function Panel({ children, title, subtitle, actions, className = '' }: { children: ReactNode; title?: string; subtitle?: string; actions?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>
    {(title || subtitle || actions) && <div className="panel-heading">
      <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="panel-actions">{actions}</div>}
    </div>}
    {children}
  </section>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = /completed|paid|active|received|dispensed|reviewed|in stock|approved/.test(normalized) ? 'success'
    : /urgent|expired|void|cancelled|inactive|out of stock|critical/.test(normalized) ? 'danger'
      : /low|pending|scheduled|submitted|draft|processing|waiting|part paid|in progress|checked in|ordered|collected/.test(normalized) ? 'warning'
        : 'neutral';
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? XCircle : tone === 'warning' ? Clock3 : AlertTriangle;
  return <span className={`status-badge status-${tone}`}><Icon size={13} strokeWidth={2} />{value}</span>;
}

export function Metric({ label, value, detail, trend, icon }: { label: string; value: string | number; detail: string; trend?: 'up' | 'down' | 'steady'; icon?: ReactNode }) {
  return <div className="metric-card">
    <div className="metric-top"><span>{label}</span>{icon && <span className="metric-icon">{icon}</span>}</div>
    <div className="metric-value">{value}</div>
    <div className="metric-detail">{trend && <ArrowUpRight size={14} className={`trend-${trend}`} />}{detail}</div>
  </div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-mark"><span /></div><strong>{title}</strong><p>{detail}</p>{action}</div>;
}
