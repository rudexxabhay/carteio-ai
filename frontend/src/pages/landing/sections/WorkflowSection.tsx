import { ArrowDown, ArrowRight, Check, Database, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';

const stages = [
  { step: '01', title: 'Customer question', detail: 'A person asks for help in a website or app.', icon: MessageCircle, accent: 'flow-customer' },
  { step: '02', title: 'Carteio AI', detail: 'The assistant interprets the request and finds the right next step.', icon: Sparkles, accent: 'flow-ai' },
  { step: '03', title: 'Knowledge or approved API', detail: 'Use selected business content or a registered connection.', icon: Database, accent: 'flow-source' },
  { step: '04', title: 'Permission validation', detail: 'The backend checks identity, scope, and business rules.', icon: ShieldCheck, accent: 'flow-permission' },
  { step: '05', title: 'Helpful answer or action', detail: 'Respond with context or request an authorized operation.', icon: Check, accent: 'flow-answer' },
];

export function WorkflowSection() {
  return (
    <section className="workflow-showcase" id="workflow" aria-labelledby="workflow-title">
      <div className="landing-container workflow-showcase-inner">
        <div className="section-heading-row workflow-heading"><div><div className="section-kicker">HOW IT IS DESIGNED TO WORK</div><h2 id="workflow-title">A clear path from question<br/><span>to a trusted next step.</span></h2></div><p>Knowledge can ground an answer. Any business action must pass through an authorized backend connection.</p></div>
        <div className="workflow-rail" aria-label="Customer question flows through Carteio AI, verified knowledge or an approved API, permission validation, and a helpful response or authorized action.">
          {stages.map(({step, title, detail, icon: Icon, accent}, index) => <div className="workflow-stage-wrap" key={step}><article className={`workflow-stage ${accent}`}><span className="stage-step">{step}</span><span className="stage-icon"><Icon size={20}/></span><h3>{title}</h3><p>{detail}</p></article>{index < stages.length - 1 && <span className="workflow-arrow" aria-hidden="true"><ArrowRight size={17}/><ArrowDown size={17}/></span>}</div>)}
        </div>
        <div className="workflow-rule"><ShieldCheck size={17}/><span>AI output never grants its own access. Server-side permissions and business rules govern every tool execution.</span></div>
      </div>
    </section>
  );
}
