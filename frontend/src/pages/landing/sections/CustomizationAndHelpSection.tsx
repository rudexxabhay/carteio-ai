import { ArrowRight, BadgeHelp, BookOpen, Check, ChevronDown, Code2, Globe2, Languages, Palette, ShieldCheck, Sparkles, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

const settings = ['Assistant name', 'Logo & avatar', 'Color theme', 'Greeting', 'Response style', 'Language', 'Knowledge scope', 'Human handoff', 'Allowed operations'];
const questions = [
  ['What is Carteio AI?', 'Carteio AI is being built as a platform for creating business assistants that can use approved knowledge and, where configured, explicitly authorized tools.'],
  ['Can it connect to any website?', 'Connection options depend on how a site is built and which interfaces it exposes. Some setups may use a supported plugin; others require developer work through an SDK or API.'],
  ['Does Carteio AI need database access?', 'A direct database password should not be shared with an assistant. Future integrations are intended to use narrow server-side APIs that enforce the application’s own authorization rules.'],
  ['Can the owner disable AI permissions?', 'Owner-controlled scopes and revocation are planned. Disabling access must also be enforced by the backend that owns the connected operation.'],
  ['Can it access customer order information?', 'Only a future, configured integration with the right user identity checks could expose order details. A store owner’s integration approval alone does not prove that a customer may view an order.'],
  ['Is coding required?', 'Not always. A supported plugin or a knowledge-only setup may need less development. Custom APIs and backend SDK integrations generally require a developer.'],
  ['Can I use it with Shopify or WooCommerce?', 'Those platforms are planned integration targets, but no live connector is available in this Phase 01 foundation. Actual support will depend on the integration released for each platform.'],
  ['Is AI always accurate?', 'No. Generative AI can make mistakes and source material can be incomplete or outdated. The product is planned to ground answers, validate changing facts, and admit uncertainty.'],
  ['What happens when an API is unavailable?', 'A future assistant should explain that it could not verify the live information, avoid inventing a result, and offer an appropriate next step or human handoff.'],
  ['Can my website have multiple AI assistants?', 'Multiple assistants are part of the product direction. Website-level configuration and access boundaries will need to be defined before that capability is available.'],
  ['Do I need to share my database password?', 'No. Do not share database passwords with an AI assistant. Future connections should use scoped backend credentials and approved operations.'],
  ['Can developers use a backend SDK?', 'A backend SDK is planned for registering specific functions. Developers would remain responsible for business validation, identity checks, and limiting each function’s permissions.'],
] as const;

export function CustomizationAndHelpSection() {
  return (
    <>
      <section className="landing-section landing-container customize-section" id="customize" aria-labelledby="customize-title">
        <div className="customize-copy"><div className="section-kicker">MAKE IT FIT YOUR BUSINESS</div><h2 id="customize-title">Your assistant should<br/><span>feel like it belongs.</span></h2><p>Future configuration is intended to give teams control over presentation, response behavior, knowledge scope, escalation, and approved operations.</p><div className="customize-settings">{settings.map((setting) => <span key={setting}><Check size={12}/>{setting}</span>)}</div><p className="customize-note">Illustrative configuration preview. These settings are not active yet.</p></div>
        <div className="customize-preview" aria-label="Illustrative future chatbot customization preview; settings are not interactive">
          <div className="customize-preview-header"><span className="preview-mark"><Sparkles size={16}/></span><div><strong>Carteio assistant</strong><small>Illustrative preview</small></div><span className="preview-header-dots">•••</span></div>
          <div className="customize-preview-body"><span className="preview-greeting">Hello there 👋</span><p>How can I help you today?</p><span className="preview-question">Can you help me choose a product?</span></div>
          <div className="customize-preview-footer"><span>Ask a question…</span><span className="preview-send"><ArrowRight size={15}/></span></div>
          <div className="preview-customization-panel"><strong><Palette size={14}/> Appearance</strong><span className="preview-color-dots"><i/><i/><i/></span><span className="preview-option">Brand color <b>Ocean Blue</b></span><span className="preview-option">Language <b><Languages size={12}/> English</b></span><span className="preview-option">Knowledge scope <b><ShieldCheck size={12}/> Approved sources</b></span></div>
        </div>
      </section>
      <section className="developer-help-section" id="developer-help" aria-labelledby="developer-help-title">
        <div className="landing-container developer-help-inner"><div><div className="section-kicker">CLEAR GUIDANCE FOR EVERY CONNECTION</div><h2 id="developer-help-title">Build with a guide<br/><span>at every step.</span></h2><p>Documentation and support foundations are in place. Detailed installation guides will follow as integrations become available.</p><div className="developer-topics"><span><Code2 size={15}/> JavaScript widget</span><span><BookOpen size={15}/> Backend SDK</span><span><Webhook size={15}/> APIs & webhooks</span><span><ShieldCheck size={15}/> Auth & permissions</span><span><Globe2 size={15}/> Shopify & WooCommerce guides</span><span><BadgeHelp size={15}/> Errors & troubleshooting</span></div><div className="developer-ctas"><Link className="landing-button landing-button-primary" to="/docs">Explore documentation <ArrowRight size={16}/></Link><Link className="landing-button landing-button-outline" to="/help">Visit help center <BadgeHelp size={16}/></Link></div></div><div className="docs-preview" aria-hidden="true"><div className="docs-preview-sidebar"><span/><span/><span/><span/></div><div className="docs-preview-content"><span className="docs-line docs-line-short"/><span className="docs-line docs-line-title"/><span className="docs-line docs-line-wide"/><span className="docs-code"><i/><i/><i/><i/></span><span className="docs-line docs-line-medium"/><span className="docs-line docs-line-wide"/></div><div className="docs-preview-badge"><Globe2 size={17}/> Developer guides</div></div></div>
      </section>
      <section className="landing-section landing-container faq-section" id="faq" aria-labelledby="faq-title">
        <div className="faq-heading"><div className="section-kicker">GOOD QUESTIONS</div><h2 id="faq-title">A few things worth<br/><span>knowing up front.</span></h2><p>Carteio AI is in early development. These answers describe the product direction and its current limits.</p><Link className="landing-text-link" to="/help">More help and guidance <ArrowRight size={15}/></Link></div>
        <div className="faq-list">{questions.map(([question, answer], index) => <details className="faq-item" key={question} open={index === 0}><summary><span>{question}</span><ChevronDown size={17} aria-hidden="true"/></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className="landing-final-cta"><div className="landing-container final-cta-content"><div className="final-cta-decoration"/><div><span className="landing-eyebrow landing-eyebrow-light"><i/> THE FOUNDATION FOR WHAT COMES NEXT</span><h2>Make your website<br/><span>AI-ready.</span></h2><p>Explore the product direction and see how Carteio AI is being designed to connect helpful answers with business boundaries.</p></div><div className="final-cta-actions"><Link className="landing-button landing-button-white" to="/features">Explore the product <ArrowRight size={17}/></Link><Link className="landing-cta-secondary" to="/docs">Visit documentation <ArrowRight size={15}/></Link></div></div></section>
    </>
  );
}
