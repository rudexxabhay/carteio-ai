import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Building2, Globe2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { ApiError } from '../../services/api/client';
import { createWorkspace } from '../../services/api/workspaces';
import { WorkspaceEntry } from './WorkspaceEntry';

function suggestedSlug(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63).replace(/-$/g, '');
}

function OnboardingForm() {
  const navigate = useNavigate();
  const { reload, remember } = useWorkspaces();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!slugEdited) setSlug(suggestedSlug(name)); }, [name, slugEdited]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 200) nextErrors.name = 'Use a workspace name between 2 and 200 characters.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim().toLowerCase()) || slug.trim().length > 63) nextErrors.slug = 'Use letters, numbers, and single hyphens only (up to 63 characters).';
    if (websiteUrl.trim()) {
      try { const url = new URL(websiteUrl.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { nextErrors.websiteUrl = 'Enter a valid http or https website URL.'; }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const workspace = await createWorkspace({ name: name.trim(), slug: slug.trim(), ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}), ...(businessType ? { businessType } : {}) });
      await reload();
      remember(workspace.slug);
      navigate(`/workspace/${encodeURIComponent(workspace.slug)}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.code === 'WORKSPACE_SLUG_UNAVAILABLE' || cause.code === 'INVALID_WORKSPACE_SLUG' || cause.code === 'RESERVED_WORKSPACE_SLUG') {
          setErrors({ slug: cause.message });
        } else if (cause.code === 'INVALID_WEBSITE_URL') setErrors({ websiteUrl: cause.message });
        else setErrors({ form: cause.message });
      } else setErrors({ form: 'We could not create your workspace. Please try again.' });
    } finally { setSubmitting(false); }
  }

  return <main className="onboarding-page">
    <Meta title="Create your workspace" description="Set up your Carteio AI workspace." path="/onboarding" noIndex />
    <div className="onboarding-brand"><span className="onboarding-mark">C</span><span>Carteio <i>AI</i></span></div>
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-icon"><Sparkles size={20}/></div>
      <span className="eyebrow">YOUR BUSINESS, YOUR WORKSPACE</span>
      <h1 id="onboarding-title">Create your workspace</h1>
      <p className="onboarding-intro">A secure home for your team and the business knowledge you choose to connect.</p>
      <form onSubmit={submit} noValidate>
        <label className="workspace-field" htmlFor="workspace-name">Workspace / Company Name <span aria-hidden="true">*</span>
          <input id="workspace-name" autoComplete="organization" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'workspace-name-error' : undefined} placeholder="Carteio"/>
          {errors.name && <small id="workspace-name-error" className="workspace-field-error">{errors.name}</small>}
        </label>
        <label className="workspace-field" htmlFor="workspace-slug">Workspace URL Slug <span aria-hidden="true">*</span>
          <span className="slug-input"><span>ai.carteio.in/workspace/</span><input id="workspace-slug" autoCapitalize="none" autoComplete="off" maxLength={63} value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.trimStart().toLowerCase().replace(/[\s_]+/g, '-')); setErrors((current) => ({ ...current, slug: '' })); }} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? 'workspace-slug-error' : 'workspace-slug-help'}/></span>
          {errors.slug ? <small id="workspace-slug-error" className="workspace-field-error">{errors.slug}</small> : <small id="workspace-slug-help">Your unique workspace address. You can adjust the suggestion.</small>}
        </label>
        <label className="workspace-field" htmlFor="workspace-website">Business Website <span className="optional-label">Optional</span>
          <span className="field-with-icon"><Globe2 size={16}/><input id="workspace-website" type="url" inputMode="url" autoComplete="url" maxLength={2048} value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} aria-invalid={Boolean(errors.websiteUrl)} placeholder="https://example.com"/></span>
          <small>{errors.websiteUrl ? <span className="workspace-field-error">{errors.websiteUrl}</span> : 'Saved to your profile only. This does not verify or connect the website.'}</small>
        </label>
        <label className="workspace-field" htmlFor="workspace-business-type">Business Type <span className="optional-label">Optional</span>
          <select id="workspace-business-type" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>
            <option value="">Choose a business type</option><option>SaaS / Technology</option><option>Professional services</option><option>Retail / Ecommerce</option><option>Healthcare</option><option>Education</option><option>Other</option>
          </select>
        </label>
        {errors.form && <div className="workspace-form-error" role="alert">{errors.form}</div>}
        <button className="button button-primary onboarding-submit" type="submit" disabled={submitting}><Building2 size={16}/>{submitting ? 'Creating workspace…' : 'Create workspace'}<ArrowRight size={16}/></button>
      </form>
      <p className="onboarding-security">Your workspace is private to its authorized members.</p>
    </section>
  </main>;
}

export function OnboardingPage() {
  return <WorkspaceEntry allowEmpty><OnboardingForm/></WorkspaceEntry>;
}
