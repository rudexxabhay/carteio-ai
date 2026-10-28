import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { Meta } from '../../components/common/Meta';
import { ApiError } from '../../services/api/client';
import { listWorkspaceMembers, type WorkspaceMember, type WorkspaceMembersPage } from '../../services/api/workspaces';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function WorkspaceTeamPage() {
  const { workspace } = useWorkspaceRoute();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ slug: string; page: number; data: WorkspaceMembersPage | null; error: string | null }>({ slug: '', page: 0, data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    listWorkspaceMembers(workspace.slug, page, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ slug: workspace.slug, page, data, error: null });
    }).catch((cause) => {
      if (!controller.signal.aborted) setResult({ slug: workspace.slug, page, data: null, error: cause instanceof ApiError && cause.status === 404 ? 'Workspace members are unavailable.' : 'We could not load workspace members.' });
    });
    return () => controller.abort();
  }, [workspace.slug, page, retry]);

  const current = result.slug === workspace.slug && result.page === page ? result : null;
  const members = current?.data;
  const totalPages = members ? Math.max(1, Math.ceil(members.total / members.pageSize)) : 1;

  return <>
    <Meta title="Workspace team" description={`Authorized members of ${workspace.name}.`} path={`/workspace/${workspace.slug}/team`} noIndex/>
    <PageHeader eyebrow="Team & Workspace" title="Workspace members" desc={`People with active access to ${workspace.name}.`}/>
    <section className="workspace-panel member-panel">
      <div className="workspace-panel-heading"><div><h2>Members</h2><p>{members ? `${members.total} active ${members.total === 1 ? 'member' : 'members'}` : 'Loading authorized members…'}</p></div><span className="workspace-role-chip">You are {workspace.currentUserRole || workspace.role}</span></div>
      {current?.error && <div className="workspace-inline-error" role="alert">{current.error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      {!members && !current?.error && <div className="member-skeleton" role="status" aria-label="Loading members"><i/><i/><i/></div>}
      {members && <>
        <div className="member-list">{members.members.map((member: WorkspaceMember) => <article className="member-row" key={member.id}>
          <span className="member-avatar">{(member.name || 'M').slice(0, 1).toUpperCase()}</span><span className="member-info"><strong>{member.name || 'Workspace member'}</strong><small>Joined {new Date(member.joinedAt).toLocaleDateString()}</small></span><span className="member-role"><Shield size={14}/>{member.role}</span>
        </article>)}</div>
        {totalPages > 1 && <div className="workspace-pagination"><span>Page {page} of {totalPages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </>}
      <p className="workspace-panel-footnote">Member invitations and access changes are not available in this phase.</p>
    </section>
  </>;
}
