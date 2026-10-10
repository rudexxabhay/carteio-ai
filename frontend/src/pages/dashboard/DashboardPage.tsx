import { ArrowRight, Bot, Building2, FileText, Globe2, MessageSquare, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';

function FeatureCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <article className="workspace-feature-card"><div className="workspace-feature-icon"><Icon size={18}/></div><h3>{title}</h3><div className="workspace-feature-copy">{children}</div></article>;
}

export function DashboardPage() {
  const { workspace } = useWorkspaceRoute();
  return <>
    <Meta title={`${workspace.name} workspace`} description="Your Carteio AI business workspace." path={`/workspace/${workspace.slug}`} noIndex/>
    <section className="workspace-welcome">
      <div><span className="eyebrow">WORKSPACE OVERVIEW</span><h1>Welcome to {workspace.name}</h1><p>Your private workspace is ready. You control who can access your business information.</p></div>
      <span className="workspace-welcome-mark"><Building2 size={25}/></span>
    </section>

    <section className="workspace-summary-grid" aria-label="Workspace summary">
      <article className="workspace-summary-card"><span className="workspace-summary-icon"><Building2 size={17}/></span><span className="workspace-summary-label">Workspace status</span><strong><i className="workspace-status-dot"/> Active</strong><small>/{workspace.slug}</small></article>
      <article className="workspace-summary-card"><span className="workspace-summary-icon"><Users size={17}/></span><span className="workspace-summary-label">Your role</span><strong className="workspace-role-value">{workspace.currentUserRole || workspace.role}</strong><small>Membership verified</small></article>
      <article className="workspace-summary-card workspace-setup-card"><span className="workspace-summary-icon"><FileText size={17}/></span><span className="workspace-summary-label">Workspace setup</span><strong>Workspace profile is ready</strong><small>Assistant settings can be saved. Knowledge and live AI responses are not connected.</small></article>
    </section>

    <div className="workspace-section-heading"><div><span className="eyebrow">YOUR BUSINESS</span><h2>Workspace tools</h2></div><span className="workspace-roadmap-note">Features will appear as they become available</span></div>
    <section className="workspace-feature-grid">
      <FeatureCard icon={Bot} title="AI Assistants"><p>Save reusable assistant purpose, instructions, language and response style.</p><span className="feature-coming-soon">Configuration only · No live AI responses</span><Link className="workspace-disabled-action assistant-dashboard-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}>Open AI assistants <ArrowRight size={14}/></Link></FeatureCard>
      <FeatureCard icon={FileText} title="Knowledge Base"><p>Register a website and optionally save FAQs or approved reference text.</p><span className="feature-coming-soon">Sources are not scanned or indexed yet</span><Link className="workspace-disabled-action assistant-dashboard-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge`}>Open Knowledge Base <ArrowRight size={14}/></Link></FeatureCard>
      <FeatureCard icon={Globe2} title="Connected Websites"><p>Register a public website as a reference source for this workspace.</p><Link className="workspace-disabled-action assistant-dashboard-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge`}>Connect a website <ArrowRight size={14}/></Link></FeatureCard>
      <FeatureCard icon={MessageSquare} title="Conversations"><p>Conversation tools will be available when assistants launch.</p><span className="feature-empty-label">Conversation data is not available yet</span></FeatureCard>
    </section>

    <section className="workspace-team-panel"><div className="workspace-team-icon"><Users size={18}/></div><div><span className="eyebrow">TEAM & WORKSPACE</span><h2>{workspace.name}</h2><p>You’re signed in as a workspace {workspace.currentUserRole || workspace.role}. Review member access or update workspace details.</p></div><div className="workspace-team-actions"><Link to={`/workspace/${encodeURIComponent(workspace.slug)}/team`}>View members <ArrowRight size={14}/></Link><Link to={`/workspace/${encodeURIComponent(workspace.slug)}/settings`}>Workspace settings <ArrowRight size={14}/></Link></div></section>
  </>;
}
