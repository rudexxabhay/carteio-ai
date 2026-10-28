import type { ReactNode } from 'react';
import { AlertTriangle, CircleAlert, LoaderCircle, LockKeyhole, WifiOff } from 'lucide-react';
import './error-states.css';

type Action = { label: string; onClick: () => void; disabled?: boolean };
type ErrorStateProps = {
  title: string;
  message: string;
  action?: Action;
  secondary?: ReactNode;
  compact?: boolean;
  icon?: 'error' | 'network' | 'access';
};

export function ErrorState({ title, message, action, secondary, compact = false, icon = 'error' }: ErrorStateProps) {
  const Icon = icon === 'network' ? WifiOff : icon === 'access' ? LockKeyhole : CircleAlert;
  return <section className={`carteio-error-state${compact ? ' is-compact' : ''}`} role="alert">
    <span className="carteio-error-icon"><Icon size={compact ? 18 : 22} aria-hidden="true"/></span>
    <div className="carteio-error-copy"><h2>{title}</h2><p>{message}</p></div>
    {(action || secondary) && <div className="carteio-error-actions">
      {action && <button type="button" className="carteio-error-primary" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
      {secondary}
    </div>}
  </section>;
}

export function RouteError(props: ErrorStateProps) { return <ErrorState {...props}/>; }
export function SectionError(props: ErrorStateProps) { return <ErrorState compact {...props}/>; }
export function NetworkError(props: Omit<ErrorStateProps, 'icon'>) { return <ErrorState icon="network" {...props}/>; }
export function AccessDenied(props: Omit<ErrorStateProps, 'icon'>) { return <ErrorState icon="access" {...props}/>; }

export function FullPageError({ title = 'We couldn’t load this page.', message = 'The page encountered an unexpected error. Reload to try again.', onReload }: { title?: string; message?: string; onReload: () => void }) {
  return <main className="carteio-full-error" role="alert"><div className="carteio-full-error-card"><span className="carteio-error-icon"><AlertTriangle size={22} aria-hidden="true"/></span><p className="carteio-error-eyebrow">Something went wrong</p><h1>{title}</h1><p className="carteio-error-description">{message}</p><button type="button" className="carteio-error-primary" onClick={onReload}>Reload page</button></div></main>;
}

export function LoadingState({ label = 'Loading…', skeleton = false, compact = false }: { label?: string; skeleton?: boolean; compact?: boolean }) {
  if (skeleton) return <div className={`carteio-loading-skeleton${compact ? ' is-compact' : ''}`} role="status" aria-label={label} aria-busy="true"><span/><span/><span/></div>;
  return <div className={`carteio-loading-state${compact ? ' is-compact' : ''}`} role="status" aria-live="polite"><LoaderCircle size={18} aria-hidden="true"/><span>{label}</span></div>;
}

export function NotFoundState({ onHome }: { onHome: () => void }) {
  return <section className="carteio-full-error"><div className="carteio-full-error-card"><p className="carteio-error-eyebrow">404 · PAGE NOT FOUND</p><h1>This page isn’t here.</h1><p className="carteio-error-description">The address may be wrong, or the page may have moved.</p><button type="button" className="carteio-error-primary" onClick={onHome}>Back to home</button></div></section>;
}
export const NotFound = NotFoundState;
