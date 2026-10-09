import { ArrowRight, Blocks, Braces, Code2, Database, Globe2, Layers3, Puzzle, ShoppingBag, Smartphone, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';

const capabilityGroups = [
  { title: 'Support & discovery', icon: Globe2, items: ['Customer support', 'Knowledge-based answers', 'Business FAQs', 'Product discovery', 'Product comparison', 'Multilingual support'] },
  { title: 'Connected operations', icon: Workflow, items: ['Stock checking', 'Authenticated order tracking', 'Authorized cart operations', 'Human handoff'] },
  { title: 'Owner & team insight', icon: Layers3, items: ['Agent workflows', 'Conversation analytics', 'Scoped tool access', 'Approval-aware actions'] },
] as const;

const platforms = [
  { title: 'E-commerce', icon: ShoppingBag, items: ['Shopify', 'WooCommerce', 'Custom e-commerce'] },
  { title: 'Web development', icon: Code2, items: ['React', 'MERN', 'PHP', 'Python', 'Java', 'Custom REST APIs'] },
  { title: 'Business systems', icon: Database, items: ['ERP', 'CRM', 'Logistics / TMS', 'Finance apps', 'Customer portals'] },
  { title: 'More surfaces', icon: Smartphone, items: ['Mobile apps', 'SaaS products', 'Custom applications'] },
] as const;

const methods = [
  { method: 'Prebuilt platform plugin', who: 'Merchant installs and authorizes a supported plugin', access: 'Only the scopes shown during platform authorization', work: 'Setup steps vary; a supported plugin is required', icon: Puzzle },
  { method: 'Backend SDK', who: 'Your developer', access: 'Only approved functions the developer explicitly registers', work: 'Backend development and security review are needed', icon: Blocks },
  { method: 'Custom REST API', who: 'Your developer', access: 'Documented endpoints, authentication, and parameter mappings', work: 'API documentation and integration work are needed', icon: Braces },
  { method: 'Knowledge-only assistant', who: 'Business owner or content team', access: 'Approved public pages, guides, and FAQs', work: 'No private operation connection; content preparation still matters', icon: Globe2 },
] as const;

export function CapabilitiesAndConnectionsSection() {
  return (
    <>
      <section className="landing-section landing-container capabilities-section" id="capabilities" aria-labelledby="capabilities-title">
        <div className="section-heading-row"><div><div className="section-kicker">PLANNED CAPABILITIES</div><h2 id="capabilities-title">Useful in the moments<br/><span>that matter to customers.</span></h2></div><div className="roadmap-label"><span/> Product direction <small>Planned, not live yet</small></div></div>
        <div className="capability-groups">{capabilityGroups.map(({title, icon: Icon, items}, index) => <article className={`capability-group capability-group-${index}`} key={title}><div className="capability-group-heading"><span><Icon size={18}/></span><h3>{title}</h3></div><ul>{items.map((item) => <li key={item}><span className="capability-bullet"/>{item}</li>)}</ul></article>)}</div>
        <p className="capability-footnote">Capabilities depend on the connected data, platform, permissions, and product availability. No connected tools are active in this Phase 01 foundation.</p>
      </section>
      <section className="landing-section connections-section" id="integrations" aria-labelledby="connections-title">
        <div className="landing-container"><div className="section-heading-row"><div><div className="section-kicker">CONNECT WHERE BUSINESS HAPPENS</div><h2 id="connections-title">A flexible connection story,<br/><span>for different kinds of systems.</span></h2></div><p>Integration needs differ across platforms. The available method depends on the system, its APIs, and the access it supports.</p></div>
          <div className="platform-grid">{platforms.map(({title, icon: Icon, items}, index) => <article className={`platform-category platform-category-${index}`} key={title}><div className="platform-heading"><span><Icon size={19}/></span><h3>{title}</h3></div><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div>
          <div className="platform-honesty"><span className="platform-honesty-icon"><Database size={18}/></span><p><strong>Connection does not mean unrestricted access.</strong> A platform needs a supported interface, properly scoped credentials, and backend checks for each operation.</p><Link to="/integrations">Integration overview <ArrowRight size={15}/></Link></div>
        </div>
      </section>
      <section className="landing-section landing-container method-section" id="methods" aria-labelledby="methods-title">
        <div className="section-heading-row"><div><div className="section-kicker">CHOOSE A CONNECTION PATH</div><h2 id="methods-title">Four ways to get started.<br/><span>Different needs, different setup.</span></h2></div><p>A company can start with helpful content and add a business connection later if it makes sense.</p></div>
        <div className="method-list">{methods.map(({method, who, access, work, icon: Icon}, index) => <article className="method-row" key={method}><span className="method-number">0{index + 1}</span><span className="method-icon"><Icon size={19}/></span><div className="method-name"><h3>{method}</h3><span>{index === 3 ? 'Knowledge connection' : 'Business connection'}</span></div><div className="method-detail"><small>WHO SETS IT UP</small><p>{who}</p></div><div className="method-detail"><small>WHAT IT CAN REACH</small><p>{access}</p></div><div className="method-detail"><small>DEVELOPMENT</small><p>{work}</p></div></article>)}</div>
        <p className="method-note">These are planned integration patterns, not currently available connectors. Never share a database password with an assistant.</p>
      </section>
    </>
  );
}
