import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { ThemeSwitcher } from './ThemeSwitcher';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../../app/providers/AuthProvider';

const links = [
  ['Features', '/features'],
  ['Integrations', '/integrations'],
  ['How it works', '/how-it-works'],
  ['Docs', '/docs'],
  ['Help', '/help'],
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const closeMenu = () => setOpen(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Carteio AI home" onClick={closeMenu}>
          <BrandLogo />
        </Link>
        <nav id="public-navigation" className={open ? 'top-nav is-open' : 'top-nav'} aria-label="Main navigation">
          {links.map(([name, path]) => (
            <NavLink key={path} to={path} onClick={closeMenu}>{name}</NavLink>
          ))}
          <div className="nav-actions mobile-nav-actions">
            {user ? <Link className="button button-primary button-small" to="/dashboard" onClick={closeMenu}>Dashboard</Link> : <><Link className="button button-quiet" to="/login" onClick={closeMenu}>Log in</Link><Link className="button button-primary button-small" to="/signup" onClick={closeMenu}>Get started <ArrowUpRight size={15} aria-hidden="true" /></Link></>}
          </div>
        </nav>
        <div className="header-actions">
          <ThemeSwitcher />
          <div className="header-account-actions">
            {user ? <Link className="button button-primary button-small" to="/dashboard">Dashboard</Link> : <><Link className="button button-quiet" to="/login">Log in</Link><Link className="button button-primary button-small" to="/signup">Get started <ArrowUpRight size={15} aria-hidden="true" /></Link></>}
          </div>
        </div>
        <button
          className="mobile-menu"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="public-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
