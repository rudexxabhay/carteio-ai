import { ArrowRight, Bot, CircleHelp, Database, LockKeyhole, MessageSquareText, TimerReset, Workflow } from 'lucide-react';

const problems = [
  ['Repetitive support requests', 'Give common questions a consistent, knowledge-based starting point.', MessageSquareText],
  ['Customers cannot find useful information', 'Bring approved guides, policies, and product details into a clearer answer experience.', CircleHelp],
  ['Product and order data live in separate systems', 'Plan a safe bridge between customer conversations and the systems that hold useful context.', Database],
  ['Manual status checks slow people down', 'Shape a path to authorized lookups instead of asking customers to repeat the same request.', TimerReset],
  ['Slow responses leave customers waiting', 'Make approved information easier to find whenever a customer asks.', MessageSquareText],
  ['Custom AI integrations are complicated', 'Plan developer-friendly connection paths through SDKs and documented APIs.', Workflow],
  ['AI permissions are hard to oversee', 'Keep owners in charge of the tools, scopes, approvals, and revocation an assistant may use.', LockKeyhole],
] as const;

export function WhatAndProblemsSection() {
  return (
    <>
      <section className="landing-section landing-container intro-section" id="what-is" aria-labelledby="what-title">
        <div className="section-kicker">A UNIVERSAL FOUNDATION</div>
        <div className="intro-grid">
          <div><h2 id="what-title">What is <span>Carteio AI?</span></h2><p className="section-lede">Carteio AI is being built as a universal platform for creating and connecting AI-powered assistants to websites and business applications.</p><p className="section-copy">It brings conversations, business knowledge, and carefully scoped connections into one place, while keeping business rules in the systems that own them.</p></div>
          <div className="assistant-types">
            <article className="assistant-type chatbot-type"><div className="assistant-type-icon"><Bot size={20}/></div><div><span className="type-label">AI CHATBOT</span><h3>Answers and assists</h3><p>Helps people find information, understand products, and get useful guidance.</p></div><ArrowRight size={17} aria-hidden="true"/></article>
            <article className="assistant-type agent-type"><div className="assistant-type-icon"><Workflow size={20}/></div><div><span className="type-label">AI AGENT</span><h3>Uses approved tools</h3><p>Can request supported business operations only when explicitly authorized.</p></div><ArrowRight size={17} aria-hidden="true"/></article>
            <p className="type-footnote">Every tool call remains subject to server-side authorization and business rules.</p>
          </div>
        </div>
      </section>
      <section className="landing-section problem-section" id="problems" aria-labelledby="problems-title">
        <div className="landing-container">
          <div className="section-heading-row problem-heading">
            <div>
              <div className="section-kicker">BUILT AROUND REAL WORK</div>
              <h2 id="problems-title">The conversation is simple.<br/><span>The systems behind it aren’t.</span></h2>
            </div>
            <p>Useful AI needs more than a chat window. It needs the right context, a safe connection, and clear limits.</p>
          </div>
          <div className="problem-intro">
            <span className="problem-orbit"><MessageSquareText size={21} aria-hidden="true"/></span>
            <div><strong>One helpful front door</strong><p>Carteio AI is designed to bring separate knowledge and workflows into a considered assistant experience.</p></div>
          </div>
          <div className="problem-grid">
            {problems.map(([title, solution, Icon], index) => (
              <article className={`problem-card${index === problems.length - 1 ? ' problem-card--wide' : ''}`} key={title}>
                <span className="problem-card-icon"><Icon size={19} aria-hidden="true"/></span>
                <span className="problem-index">0{index + 1}</span>
                <div className="problem-card-copy"><h3>{title}</h3><p>{solution}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
