import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

const footerGroups = [
  { title: 'Product', links: [['Features', '/features'], ['How it works', '/how-it-works'], ['Dashboard preview', '/dashboard']] },
  { title: 'Integrations', links: [['Integration overview', '/integrations'], ['Shopify & commerce', '/integrations'], ['Developer APIs', '/docs']] },
  { title: 'Resources', links: [['Documentation', '/docs'], ['Help center', '/help'], ['Security approach', '/features']] },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-topline">
        <div className="footer-brand-block">
          <Link className="brand" to="/" aria-label="Carteio AI home">
            <BrandLogo />
          </Link>
          <p>A universal foundation for business AI assistants, designed to connect approved knowledge and tools with clear owner control.</p>
        </div>
        <div className="footer-groups">
          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={`${group.title} footer links`}>
              <h2>{group.title}</h2>
              {group.links.map(([label, path]) => <Link key={label} to={path}>{label}</Link>)}
            </nav>
          ))}
          <div className="footer-coming-soon">
            <h2>Company</h2>
            <p>Company information is in development.</p>
            <p>Legal details will be published before launch.</p>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Carteio AI</span>
        <span>Designed for helpful AI with clear boundaries.</span>
      </div>
    </footer>
  );
}
