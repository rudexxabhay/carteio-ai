import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react';
import { getHealth, type HealthState } from '../../services/api/health';
import { Meta } from '../../components/common/Meta';
import { useAuth } from '../../app/providers/AuthProvider';
export function DashboardPage() {
  const { user, googleAuthState, setGoogleAuthState } = useAuth();
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal).then(result => setHealth(result ? { status: 'connected' } : { status: 'error' })).catch(() => {
      if (!controller.signal.aborted) setHealth({ status: 'error' });
    });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (health.status !== 'loading' && googleAuthState === 'DASHBOARD_NAVIGATING') setGoogleAuthState('READY');
  }, [health.status, googleAuthState, setGoogleAuthState]);
  return <>
    <Meta title="Workspace" description="Carteio AI account workspace." path="/dashboard" noIndex />
    <div className="preview-banner"><div className="preview-banner-icon"><Activity size={18} /></div><div><strong>Welcome to your workspace</strong><p>Your account is ready. Organization setup will be available in a future phase.</p></div></div>
    <div className="dash-welcome"><div><span className="eyebrow">OVERVIEW</span><h2>Welcome, {user?.name || user?.email}.</h2><p>Your Carteio AI workspace starts here.</p></div><span className="welcome-art"><Activity size={30} /></span></div>
    <section className="health-card" aria-live="polite" aria-busy={health.status === 'loading'}>
      <div className="health-card-top"><div className="health-card-icon"><Activity size={19} /></div><span className={`status-chip status-${health.status}`}><i />{health.status === 'connected' ? 'API Connected' : health.status === 'loading' ? 'Checking API…' : 'Unable to connect to API'}</span></div>
      <h3>API connection</h3>
      <p>{health.status === 'connected' ? 'Your frontend can reach the Carteio AI API.' : health.status === 'loading' ? 'Checking your connection in the background.' : 'The backend health endpoint could not be reached.'}</p>
      {health.status === 'loading' && <span className="sr-only" role="status">Setting up your workspace…</span>}
      {health.status === 'error' && <button className="button button-secondary retry-button" onClick={() => { setHealth({ status: 'loading' }); setAttempt(value => value + 1); }}><RefreshCw size={15} /> Retry connection</button>}
    </section>
    <div className="dash-info-grid"><article><div className="info-icon"><ShieldCheck size={18} /></div><h3>Account security</h3><p>{user?.emailVerified ? 'Your email address is verified.' : 'Please verify your email address.'} Account access is protected by a server managed session.</p><a href="/verify-email">Email verification <ArrowUpRight size={14} /></a></article><article><div className="info-icon info-icon-violet"><CircleAlert size={18} /></div><h3>Organization</h3><p>You are not part of an organization yet. Organization onboarding is coming in a future phase.</p><span className="organization-empty">No organization connected</span></article></div>
  </>;
}
