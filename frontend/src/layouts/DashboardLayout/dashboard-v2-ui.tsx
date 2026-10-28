import type { HTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight, CircleAlert, CircleCheck, ChevronRight, Plus, Search, type LucideIcon } from 'lucide-react';

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`.trim()} {...rest}>{children}</div>;
}

export function Badge({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'neutral' | 'red' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Btn({ children, secondary = false, onClick, disabled = false, className = '', type = 'button' }: { children: ReactNode; secondary?: boolean; onClick?: () => void; disabled?: boolean; className?: string; type?: 'button' | 'submit' }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn ${secondary ? 'btn-secondary' : 'btn-primary'} ${className}`.trim()}>{children}</button>;
}

export function PageHeader({ eyebrow, title, desc, action, children, statusLabel }: { eyebrow: string; title: string; desc: string; action?: ReactNode; children?: ReactNode; statusLabel?: string }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p>{children}</div><div className="page-actions">{statusLabel && <span className="sample-mark">{statusLabel}</span>}{action}</div></div>;
}

export function Stat({ label, value, change, positive = true, icon: Icon }: { label: string; value: string; change: string; positive?: boolean; icon?: LucideIcon }) {
  return <Card className="metric"><div className="metric-top"><span>{label}</span>{Icon ? <span className="metric-icon"><Icon size={18}/></span> : <span className="metric-icon metric-dot"/>}</div><strong>{value}</strong><small className={positive ? 'pos' : 'muted'}>{change}</small></Card>;
}

export function FilterInput({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return <label className={`search-field ${className}`.trim()}><Search size={18}/><input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)}/></label>;
}

export function Field({ label, value, placeholder = '', kind = 'text', onChange, large = false, options = [] }: { label: string; value?: string; placeholder?: string; kind?: 'text' | 'textarea' | 'select'; onChange?: (value: string) => void; large?: boolean; options?: Array<{ value: string; label: string }> }) {
  return <label className={`field ${large ? 'field-wide' : ''}`.trim()}><span>{label}</span>{kind === 'textarea' ? <textarea value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)}/> : kind === 'select' ? <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value)}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)}/>}</label>;
}

export function Toggle({ label, desc, checked, onChange, disabled = false }: { label: string; desc?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <div className="toggle-row"><div><strong>{label}</strong>{desc && <p>{desc}</p>}</div><button className={`toggle ${checked ? 'on' : ''}`} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span/></button></div>;
}

export function SectionHeader({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return <div className="section-header"><div><h3>{title}</h3>{desc && <p>{desc}</p>}</div>{action}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap"><table className="data-table">{children}</table></div>;
}

export function Empty({ title = 'No data available', desc = 'Data will appear here when the connected workspace service provides it.' }: { title?: string; desc?: string }) {
  return <div className="empty"><CircleAlert size={27}/><strong>{title}</strong><p>{desc}</p></div>;
}

export function Notice({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'green' }) {
  return <div className={`notice notice-${tone}`}>{tone === 'green' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>}<span>{children}</span></div>;
}

export function Bars({ values, labels = [] }: { values: number[]; labels?: string[] }) {
  if (values.length === 0) return <Empty title="No trend data" desc="A time series has not been returned by the connected service."/>;
  const max = Math.max(...values, 1);
  return <div className="bar-chart"><div className="gridlines"><i/><i/><i/><i/></div><div className="bars">{values.map((value, index) => <div className="bar-col" key={`${labels[index] ?? index}`}><div className={`bar ${index === values.length - 1 ? 'bar-last' : ''}`} style={{ height: `${Math.max(7, value / max * 100)}%` }} title={labels[index] ? `${labels[index]}: ${value}` : String(value)}/></div>)}</div>{labels.length > 0 && <div className="chart-labels">{labels.map((label) => <span key={label}>{label}</span>)}</div>}</div>;
}

export function Progress({ label, value, color = 'blue' }: { label: string; value: number; color?: string }) {
  return <div className="progress-item"><div><span>{label}</span><strong>{value}%</strong></div><div className="track"><span className={color} style={{ width: `${value}%` }}/></div></div>;
}

export function QuickLink({ title, desc, icon: Icon, onClick, meta }: { title: string; desc: string; icon: LucideIcon; onClick: () => void; meta?: string }) {
  return <button className="quick-link" onClick={onClick}><span className="quick-icon"><Icon size={21}/></span><span><strong>{title}</strong><small>{desc}</small></span>{meta ? <Badge tone="neutral">{meta}</Badge> : <ArrowUpRight size={17} className="link-arrow"/>}</button>;
}

export function ViewAll({ onClick, text = 'View all' }: { onClick: () => void; text?: string }) {
  return <button className="text-link" onClick={onClick}>{text}<ChevronRight size={15}/></button>;
}

export function CircleIcon({ icon: Icon, large = false }: { icon: LucideIcon; large?: boolean }) {
  return <span className={`circle-icon ${large ? 'large' : ''}`.trim()}><Icon size={large ? 27 : 20}/></span>;
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <Btn onClick={onClick}><Plus size={16}/>{children}</Btn>;
}
