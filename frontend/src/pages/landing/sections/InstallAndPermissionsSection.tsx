import { ArrowRight, Check, Circle, CircleCheck, Eye, LockKeyhole, ShieldCheck, SlidersHorizontal, UserRoundCheck } from 'lucide-react';

const onboarding = [
  'Create a Carteio AI account',
  'Register your website',
  'Choose a connection method',
  'Connect plugin, SDK, or API',
  'Review discovered capabilities',
  'Approve only needed permissions',
  'Add approved knowledge sources',
  'Customize the assistant',
  'Test safely with sample scenarios',
  'Publish when you are ready',
];

const policyRows = [
  { name: 'Read public product details', group: 'READ ONLY', status: 'Allowed', icon: Eye, state: 'policy-allowed' },
  { name: 'Check an authenticated order', group: 'CUSTOMER DATA', status: 'Verify identity', icon: UserRoundCheck, state: 'policy-review' },
  { name: 'Change or cancel an order', group: 'WRITE ACTION', status: 'Human approval', icon: LockKeyhole, state: 'policy-approval' },
  { name: 'Refund or change payment', group: 'SENSITIVE', status: 'Disabled by default', icon: Circle, state: 'policy-disabled' },
];

export function InstallAndPermissionsSection() {
  return (
    <>
      <section className="journey-section" aria-labelledby="journey-title">
        <div className="landing-container journey-inner"><div className="journey-heading"><div className="section-kicker">THE INTENDED SETUP JOURNEY</div><h2 id="journey-title">A deliberate setup,<br/><span>from first connection to publish.</span></h2><p>This is the product direction. Account setup, connectors, and publishing are not implemented in Phase 01.</p><a className="landing-text-link" href="#developer-help">Explore developer help <ArrowRight size={15}/></a></div>
          <ol className="journey-list">{onboarding.map((step, index) => <li key={step}><span className="journey-step-number">{String(index + 1).padStart(2, '0')}</span><span className="journey-step-dot"/><span>{step}</span>{index === onboarding.length - 1 ? <CircleCheck size={16}/> : null}</li>)}</ol>
        </div>
      </section>
      <section className="landing-section landing-container permissions-section" id="permissions" aria-labelledby="permissions-title">
        <div className="section-heading-row"><div><div className="section-kicker">OWNER CONTROL, BY DESIGN</div><h2 id="permissions-title">Give AI room to help.<br/><span>Keep the keys in your hands.</span></h2></div><p>Permissions should be specific to a website, visible to its owner, and easy to revoke. A store owner’s approval never replaces the end user’s identity checks or business rules.</p></div>
        <div className="permissions-layout"><div className="permissions-copy"><article><span className="permission-copy-icon"><SlidersHorizontal size={18}/></span><div><h3>Scope access per website</h3><p>Keep each assistant connected only to the sources and operations selected for that site.</p></div></article><article><span className="permission-copy-icon violet"><UserRoundCheck size={18}/></span><div><h3>Confirm sensitive actions</h3><p>Require the right user identity, business validation, and human approval where needed.</p></div></article><article><span className="permission-copy-icon cyan"><CircleCheck size={18}/></span><div><h3>Review and revoke</h3><p>Planned controls include activity history, permission revocation, and an emergency disable.</p></div></article><div className="permission-plan-note"><ShieldCheck size={17}/><span>These controls are planned. No real permissions or tools are active in this preview.</span></div></div>
          <div className="policy-preview" aria-label="Illustrative permission policy preview; the controls are not active">
            <div className="policy-preview-top"><span className="policy-crest"><ShieldCheck size={18}/></span><div><strong>Website action policy</strong><small>Illustrative preview · controls inactive</small></div><span className="policy-demo-badge">DEMO</span></div>
            <div className="policy-site"><span className="policy-site-dot"/> example-store.com <span>Sample website</span></div>
            <div className="policy-list">{policyRows.map(({name, group, status, icon: Icon, state}) => <div className="policy-row" key={name}><span className="policy-row-icon"><Icon size={16}/></span><div className="policy-row-main"><strong>{name}</strong><small>{group}</small></div><span className={`policy-status ${state}`}>{status}</span></div>)}</div>
            <div className="policy-footer"><span><Check size={13}/> Server checks required</span><button type="button" disabled aria-label="Emergency disable demo is not active">Emergency disable <span>OFF</span></button></div>
          </div>
        </div>
      </section>
    </>
  );
}
