import { useState, type FormEvent } from 'react';
import { Globe2, Save, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { ApiError } from '../../services/api/client';
import { updateWorkspace } from '../../services/api/workspaces';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { supportedBusinessTypes } from '../dashboard/dashboard-capabilities';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

function WorkspaceSettingsForm() {
  const { workspace, updateWorkspace: applyWorkspace } = useWorkspaceRoute();
  const { reload } = useWorkspaces();
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const [name, setName] = useState(workspace.name);
  const [websiteUrl, setWebsiteUrl] = useState(workspace.websiteUrl || '');
  const [businessType, setBusinessType] = useState(workspace.businessType || '');
  const [timezone, setTimezone] = useState(workspace.timezone || 'UTC');
  const [locale, setLocale] = useState(workspace.locale || 'en');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setSaved(false);
    if (!name.trim() || name.trim().length < 2 || name.trim().length > 200) { setError('Workspace name must be between 2 and 200 characters.'); return; }
    if (websiteUrl.trim()) {
      try { const url = new URL(websiteUrl.trim()); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { setError('Enter a valid http or https website URL.'); return; }
    }
    setSaving(true);
    try {
      const updated = await updateWorkspace(workspace.slug, { name: name.trim(), websiteUrl: websiteUrl.trim() || null, businessType: businessType.trim() || null, timezone: timezone.trim(), locale: locale.trim() });
      applyWorkspace(updated); setName(updated.name); setWebsiteUrl(updated.websiteUrl || ''); setBusinessType(updated.businessType || ''); setTimezone(updated.timezone || 'UTC'); setLocale(updated.locale || 'en'); setSaved(true); void reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save workspace settings. Please try again.');
    } finally { setSaving(false); }
  }

  return <form className="workspace-settings-form" onSubmit={submit}>
    <label className="workspace-field" htmlFor="settings-workspace-name">Workspace name<input id="settings-workspace-name" maxLength={200} value={name} onChange={(event) => setName(event.target.value)}/></label>
    <label className="workspace-field" htmlFor="settings-workspace-url">Business website <span className="optional-label">Optional</span><span className="field-with-icon"><Globe2 size={16}/><input id="settings-workspace-url" type="url" inputMode="url" maxLength={2048} value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com"/></span><small>Profile information only. Entering a URL does not verify or connect the website.</small></label>
    <label className="workspace-field" htmlFor="settings-business-type">Business type <span className="optional-label">Optional</span><select id="settings-business-type" value={businessType} disabled={!canManage} onChange={(event) => setBusinessType(event.target.value)}><option value="">Choose a business type</option>{businessType && !supportedBusinessTypes.some((option) => option.value === businessType) && <option value={businessType}>{businessType} (existing value)</option>}{supportedBusinessTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>This only changes dashboard presentation. It does not connect a website or change stored business data.</small></label>
    <label className="workspace-field" htmlFor="settings-timezone">Workspace timezone<input id="settings-timezone" maxLength={80} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Kolkata"/><small>Use an IANA timezone such as Asia/Kolkata or America/New_York.</small></label>
    <label className="workspace-field" htmlFor="settings-locale">Workspace locale<input id="settings-locale" maxLength={35} value={locale} onChange={(event) => setLocale(event.target.value)} placeholder="en-IN"/><small>Locale affects workspace display conventions; assistant response language remains configured separately.</small></label>
    {error && <div className="workspace-form-error" role="alert">{error}</div>}
    {saved && <div className="workspace-success" role="status">Workspace settings saved.</div>}
    {canManage ? <button className="button button-primary" type="submit" disabled={saving}><Save size={15}/>{saving ? 'Saving…' : 'Save changes'}</button> : <p className="settings-readonly"><ShieldCheck size={16}/> Only workspace owners and admins can edit these settings.</p>}
  </form>;
}

export function WorkspaceSettingsPage() {
  const { workspace } = useWorkspaceRoute();
  return <>
    <Meta title="Workspace settings" description={`Workspace settings for ${workspace.name}.`} path={`/workspace/${workspace.slug}/settings`} noIndex/>
    <PageHeader eyebrow="Team & Workspace" title="Workspace settings" desc={`Manage the profile and access details for ${workspace.name}.`}/>
    <section className="workspace-panel settings-panel">
      <div className="workspace-panel-heading"><div><h2>Workspace profile</h2><p>These details are visible to authorized workspace members.</p></div><span className="workspace-role-chip">{workspace.role}</span></div>
      <WorkspaceSettingsForm key={workspace.slug}/>
    </section>
    <section className="workspace-panel settings-members-panel"><div className="workspace-feature-icon"><ShieldCheck size={18}/></div><div><h2>Access and roles</h2><p>Your current role is <strong>{workspace.role}</strong>. Owner and admin permissions are enforced by the API for every settings update.</p><Link to={`/workspace/${encodeURIComponent(workspace.slug)}/team`}>View workspace members</Link></div></section>
  </>;
}
