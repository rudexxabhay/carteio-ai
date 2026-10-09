import { ArrowDown, ArrowRight, Braces, Check, CircleDot, Globe2, MessageCircle, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="landing-hero landing-container" aria-labelledby="hero-title">
      <div className="hero-copy">
        <span className="landing-eyebrow"><i /> UNIVERSAL AI FOR BUSINESS</span>
        <h1 id="hero-title">One AI Platform.<br /><span>Every Business Connection.</span></h1>
        <p className="hero-description">
          Bring intelligent conversations, trusted knowledge, and permission-controlled AI actions to your website, store, or application.
        </p>
        <div className="hero-actions">
          <a className="landing-button landing-button-primary" href="#capabilities">Explore features <ArrowRight size={17} aria-hidden="true" /></a>
          <a className="landing-button landing-button-outline" href="#workflow">How it works <ArrowDown size={16} aria-hidden="true" /></a>
        </div>
        <div className="hero-integration-note"><span className="hero-note-icon"><Braces size={16}/></span><span><strong>Built to connect.</strong> Plugin, SDK and API paths are planned; availability depends on the platform.</span></div>
      </div>
      <div className="hero-system-visual" role="img" aria-label="Illustration showing a customer conversation connected through Carteio AI to business systems">
        <div className="hero-visual-glow" />
        <svg className="hero-connectors" viewBox="0 0 540 430" aria-hidden="true">
          <path d="M104 91 C165 91 158 150 217 167" />
          <path d="M437 90 C373 91 383 151 323 167" />
          <path d="M105 341 C166 337 162 275 218 260" />
          <path d="M435 340 C373 337 381 276 323 260" />
          <circle cx="104" cy="91" r="4"/><circle cx="437" cy="90" r="4"/><circle cx="105" cy="341" r="4"/><circle cx="435" cy="340" r="4"/>
        </svg>
        <div className="hero-node hero-node-web"><Globe2 size={18}/><span>Website</span></div>
        <div className="hero-node hero-node-store"><ShoppingBag size={18}/><span>Storefront</span></div>
        <div className="hero-node hero-node-api"><Braces size={18}/><span>Business API</span></div>
        <div className="hero-node hero-node-knowledge"><CircleDot size={18}/><span>Verified knowledge</span></div>
        <div className="orchestrator-card">
          <div className="orchestrator-top"><span className="orchestrator-mark"><Sparkles size={18}/></span><span><strong>Carteio AI</strong><small>Conversation orchestration</small></span><span className="orchestrator-status">Concept</span></div>
          <div className="orchestrator-divider" />
          <div className="mini-conversation"><span className="mini-user">Can I track my order?</span><span className="mini-reply"><MessageCircle size={13}/> Knowledge + approved tools</span></div>
          <div className="orchestrator-guard"><ShieldCheck size={14}/> Permission check before action</div>
        </div>
        <div className="hero-visual-foot"><Check size={13}/> Your rules stay in control</div>
      </div>
    </section>
  );
}
