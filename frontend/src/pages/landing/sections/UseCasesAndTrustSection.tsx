import { ArrowRight, BadgeCheck, BookOpenCheck, CircleAlert, FileCheck2, SearchCheck, ShieldCheck } from 'lucide-react';

const scenarios = [
  { type: 'E-COMMERCE', title: 'Help me find running shoes under $120.', source: 'Approved catalog + current product data', outcome: 'Compare suitable options using available product information.', access: 'Catalog read access; no customer account required.', className: 'scenario-shop' },
  { type: 'LOGISTICS', title: 'Where is shipment 4821 right now?', source: 'Company shipping API', outcome: 'Look up status after verifying the requester is authorized.', access: 'Authenticated shipment lookup; identity check required.', className: 'scenario-logistics' },
  { type: 'FINANCE', title: 'Can you summarize my open expenses?', source: 'Finance application API', outcome: 'Summarize only records visible to the signed-in user.', access: 'Personal account scope; sensitive data policy applies.', className: 'scenario-finance' },
  { type: 'SAAS', title: 'How do I invite a teammate?', source: 'Approved help center content', outcome: 'Explain the documented steps and link to the relevant guide.', access: 'Knowledge only; no product account access needed.', className: 'scenario-saas' },
];

const trustSteps = [
  { title: 'Ground responses in sources', text: 'Index approved documents and retrieve relevant passages instead of answering from a blank slate.', icon: BookOpenCheck },
  { title: 'Verify live facts at the source', text: 'For changing details, use an authorized backend response where available.', icon: SearchCheck },
  { title: 'Clarify or say when it cannot tell', text: 'A helpful assistant should ask a follow-up or admit when information is missing.', icon: CircleAlert },
  { title: 'Evaluate and improve carefully', text: 'Review answer quality and content freshness as part of product operation.', icon: FileCheck2 },
];

export function UseCasesAndTrustSection() {
  return (
    <>
      <section className="landing-section use-cases-section" id="use-cases" aria-labelledby="use-cases-title">
        <div className="landing-container"><div className="section-heading-row"><div><div className="section-kicker">ILLUSTRATIVE SCENARIOS</div><h2 id="use-cases-title">Different businesses.<br/><span>Different questions to solve.</span></h2></div><p>Examples below describe possible future setups. They do not represent live connected systems.</p></div>
          <div className="scenario-list">{scenarios.map((scenario, index) => <article className={`scenario-row ${scenario.className}`} key={scenario.type}><span className="scenario-number">0{index + 1}</span><div className="scenario-question"><span>{scenario.type}</span><h3>“{scenario.title}”</h3></div><div className="scenario-detail"><small>DATA SOURCE</small><p>{scenario.source}</p></div><div className="scenario-detail"><small>ASSISTANT RESPONSE</small><p>{scenario.outcome}</p></div><div className="scenario-access"><ShieldCheck size={14}/><span>{scenario.access}</span></div></article>)}</div>
        </div>
      </section>
      <section className="landing-section landing-container trust-section" id="trust" aria-labelledby="trust-title">
        <div className="trust-copy"><div className="section-kicker">KNOWLEDGE, ACCURACY & TRUST</div><h2 id="trust-title">Ground the answer.<br/><span>Respect what is unknown.</span></h2><p>Carteio AI is planned to combine indexed knowledge with verified backend API responses. Sources can become outdated, and generative AI can still make mistakes. Grounding, validation, and evaluation are intended to reduce risk—not promise perfection.</p><div className="trust-disclaimer"><BadgeCheck size={17}/><span>No accuracy guarantees. When facts are missing or stale, the assistant should clarify or say it cannot verify them.</span></div></div>
        <div className="trust-steps">{trustSteps.map(({title, text, icon: Icon}, index) => <article key={title}><span className="trust-step-icon"><Icon size={17}/></span><div><small>0{index + 1}</small><h3>{title}</h3><p>{text}</p></div><ArrowRight size={15} aria-hidden="true"/></article>)}</div>
      </section>
      <section className="security-roadmap" aria-labelledby="security-title"><div className="landing-container security-roadmap-inner"><div className="security-roadmap-icon"><ShieldCheck size={23}/></div><div className="security-roadmap-copy"><div className="section-kicker">SECURITY IS A PRODUCT REQUIREMENT</div><h2 id="security-title">Connections should be scoped, checked, and auditable.</h2><p>Future controls are planned for tenant isolation, website-specific credentials, server-side authorization, encrypted communication, scoped permissions, audit history, and confirmation for sensitive actions. Carteio AI will not offer unrestricted AI database administration.</p><span className="security-roadmap-label">PLANNED CONTROLS · NOT A CERTIFICATION CLAIM</span></div><div className="security-badges"><span><ShieldCheck size={15}/> Scoped access</span><span><BadgeCheck size={15}/> Server-side checks</span><span><FileCheck2 size={15}/> Audit trail</span></div></div></section>
    </>
  );
}
