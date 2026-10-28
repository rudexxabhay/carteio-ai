import { Link } from 'react-router-dom';
import { ArrowUpRightIcon } from 'lucide-react';

const groups = [
  { title: 'Product', links: [{ text: 'Platform', href: '#features' }, { text: 'How it works', href: '#how-it-works' }, { text: 'Get started', href: '#pricing' }] },
  { title: 'Connections', links: [{ text: 'Integrations', href: '#integrations' }, { text: 'AI providers', href: '#integrations' }, { text: 'Shopify', href: '#integrations' }] },
  { title: 'Resources', links: [{ text: 'Frequently asked questions', href: '#faq' }, { text: 'Documentation', href: '/docs' }, { text: 'Support', href: '/help' }] },
  { title: 'Account', links: [{ text: 'Log in', href: '/login' }, { text: 'Create account', href: '/signup' }] },
  { title: 'Carteio AI', links: [{ text: 'Contact the team', href: '/help' }, { text: 'Return to top', href: '#top' }] },
];

const headingId = (title: string) => `footer-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;

export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 py-14">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-8 gap-y-10 px-4 md:grid-cols-3 lg:grid-cols-[1.4fr_repeat(5,1fr)] lg:px-8">
        <div className="col-span-2 md:col-span-3 lg:col-span-1">
          <Link to="/" className="font-semibold tracking-tight">Carteio AI</Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">AI assistants connected to your business knowledge and workflows.</p>
          <p className="mt-4 text-xs text-muted-foreground">Business context stays under your team&apos;s control.</p>
        </div>
        {groups.map((group) => <nav key={group.title} aria-labelledby={headingId(group.title)}>
          <h2 id={headingId(group.title)} className="text-sm font-semibold">{group.title}</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            {group.links.map(({ text, href }) => <li key={text}>{href.startsWith('/') ? <Link to={href} className="transition-colors hover:text-foreground">{text}</Link> : <a href={href} className="transition-colors hover:text-foreground">{text}</a>}</li>)}
          </ul>
        </nav>)}
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-2 border-t border-border/40 px-4 pt-6 text-center text-xs text-muted-foreground md:flex-row md:text-left lg:px-8">
        <span>© {new Date().getFullYear()} Carteio AI</span>
        <span>AI assistants for business, with context you control.</span>
        <a href="#top" className="inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground">Back to top <ArrowUpRightIcon className="size-3" /></a>
      </div>
    </footer>
  );
}
