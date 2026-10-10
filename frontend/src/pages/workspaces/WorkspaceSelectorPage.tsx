import { ArrowRight, Building2, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { BrandLogo } from '../../components/common/BrandLogo';
import { useAuth } from '../../app/providers/AuthProvider';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { WorkspaceEntry } from './WorkspaceEntry';

function Selector() {
  const { user } = useAuth();
  const { workspaces, remember } = useWorkspaces();
  const navigate = useNavigate();
  return <main className="workspace-selector-page">
    <Meta title="Choose a workspace" description="Choose an authorized Carteio AI workspace." path="/workspaces" noIndex />
    <header className="workspace-selector-header"><Link className="brand" to="/"><BrandLogo/></Link><span>{user?.name || user?.email}</span></header>
    <section className="workspace-selector-content">
      <span className="eyebrow">YOUR WORKSPACES</span><h1>Choose a workspace</h1><p>Continue to a workspace you’re authorized to access.</p>
      <div className="workspace-choice-list">{workspaces.map((workspace) => <button className="workspace-choice" key={workspace.id} onClick={() => { remember(workspace.slug); navigate(`/workspace/${encodeURIComponent(workspace.slug)}`); }}>
        <span className="workspace-choice-icon"><Building2 size={19}/></span><span className="workspace-choice-copy"><strong>{workspace.name}</strong><small>{workspace.role} · /{workspace.slug}</small></span><ArrowRight size={17}/>
      </button>)}</div>
      <Link className="workspace-create-link" to="/onboarding"><Plus size={16}/> Create another workspace</Link>
    </section>
  </main>;
}

export function WorkspaceSelectorPage() {
  return <WorkspaceEntry allowSelector><Selector/></WorkspaceEntry>;
}
