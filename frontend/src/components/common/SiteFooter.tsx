import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

const footerGroups = [
  { title: 'Product', links: [['Features', '/#features'], ['How it works', '/#how-it-works'], ['Use cases', '/#capabilities'], ['Dashboard', '/dashboard']] },
  { title: 'Integrations', links: [['Integration overview', '/#integrations'], ['Shopify & commerce', '/#integrations'], ['AI providers', '/#integrations']] },
  { title: 'Resources', links: [['Documentation', '/docs'], ['Help center', '/help'], ['Get started', '/signup']] },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-topline">
        <div className="footer-brand-block">
          <Link className="brand" to="/" aria-label="Carteio AI home">
            <BrandLogo />
          </Link>
          <p>Build business AI assistants with visual flows, useful knowledge, and the connections your team approves.</p>
        </div>
        <div className="footer-groups">
          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={`${group.title} footer links`}>
              <h2>{group.title}</h2>
              {group.links.map(([label, path]) => path.startsWith('/#')
                ? <a key={label} href={path}>{label}</a>
                : <Link key={label} to={path}>{label}</Link>)}
            </nav>
          ))}
          <div className="footer-coming-soon">
            <h2>Company</h2>
            <p>AI workflows for your business.</p>
            <Link to="/help">Contact and support</Link>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Carteio AI</span>
        <span>Built around your business context.</span>
      </div>
    </footer>
  );
}
