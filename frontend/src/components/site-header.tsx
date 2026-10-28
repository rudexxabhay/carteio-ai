import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRightIcon,
  FileTextIcon,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// Keep the source header's nav position and spacing; point its destinations at
// real Carteio page sections and routes.
const navLinks = [
  { href: '#features', label: 'Platform' },
  { href: '#integrations', label: 'Integrations' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Get started' },
  { href: '#faq', label: 'FAQ' },
] as const;

const searchableItems = [
  { href: '#features', title: 'Platform and AI assistants', description: 'Configure assistants and business knowledge' },
  { href: '#integrations', title: 'Integrations', description: 'Website sources, AI providers, and Shopify' },
  { href: '#how-it-works', title: 'How it works', description: 'Review assistant workflows and activity' },
  { href: '#pricing', title: 'Get started', description: 'Create a Carteio account or contact the team' },
  { href: '#faq', title: 'Frequently asked questions', description: 'Answers about Carteio AI' },
  { href: '/login', title: 'Log in', description: 'Open your Carteio account' },
  { href: '/signup', title: 'Create account', description: 'Create a Carteio account' },
];

function Search() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return searchableItems;
    return searchableItems.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(term));
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      inputRef.current?.focus();
      return () => { document.body.style.overflow = previousOverflow; };
    } else if (wasOpen.current) {
      wasOpen.current = false;
      setQuery('');
      triggerRef.current?.focus();
    }
  }, [open]);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    document.querySelector<HTMLAnchorElement>('[data-search-result]')?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search Carteio AI"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hidden h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-card/60 px-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex lg:w-56 lg:px-3"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left lg:inline">Search Carteio…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] lg:inline">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="carteio-search-title"
            className="fixed left-1/2 top-[12vh] z-[71] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
            style={{ backgroundColor: 'var(--popover)' }}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button, a[href]')).filter((node) => !node.hasAttribute('disabled'));
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}
          >
            <h2 id="carteio-search-title" className="sr-only">Search Carteio AI sections and pages</h2>
            <label className="flex items-center gap-2 border-b border-border px-4">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search assistants, integrations, workflows…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Search Carteio AI sections and pages"
              />
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close search"><XIcon className="size-4" /></button>
            </label>
              <div className="max-h-[60vh] overflow-y-auto p-2" role="list" aria-label="Search results">
              {results.length ? results.map((item) => {
                const content = <>
                  <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{item.title}</span>
                    <span className="block truncate text-xs">{item.description}</span>
                  </span>
                  <ArrowUpRightIcon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                </>;
                const className = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none";
                return item.href.startsWith('#') ? (
                  <a key={item.href} href={item.href} data-search-result role="listitem" onClick={() => setOpen(false)} className={className}>{content}</a>
                ) : (
                  <Link key={item.href} to={item.href} data-search-result role="listitem" onClick={() => setOpen(false)} className={className}>{content}</Link>
                );
              }) : (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">No Carteio sections match that search.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.querySelector('.velora-landing-root')?.classList.toggle('dark', nextDark);
  }

  return (
    <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Toggle landing page theme" onClick={toggleTheme}>
      <SunIcon className="hidden dark:block" aria-hidden="true" />
      <MoonIcon className="dark:hidden" aria-hidden="true" />
    </Button>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      document.querySelector<HTMLElement>('#carteio-mobile-nav a')?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      document.querySelector<HTMLButtonElement>('[aria-controls="carteio-mobile-nav"]')?.focus();
    }
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <Button variant="ghost" size="icon" className="size-10 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="carteio-mobile-nav" onClick={() => setOpen((current) => !current)}>
        {open ? <XIcon /> : <MenuIcon />}
      </Button>
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/10 backdrop-blur-[2px] lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <aside id="carteio-mobile-nav" role="dialog" aria-modal="true" aria-label="Carteio AI navigation" onKeyDown={(event) => {
            if (event.key === 'Tab') {
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')).filter((node) => !node.hasAttribute('disabled'));
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }} className="fixed inset-y-0 right-0 z-[71] flex h-full w-3/4 max-w-sm flex-col gap-4 border-l border-border bg-popover text-sm text-popover-foreground shadow-lg" style={{ backgroundColor: 'var(--popover)' }}>
            <div className="flex items-center justify-between p-4">
              <span className="text-base font-medium text-foreground">Carteio AI</span>
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}><XIcon /></Button>
            </div>
            <nav className="flex flex-col gap-1 px-3 pb-6" aria-label="Main navigation">
              {navLinks.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{link.label}</a>)}
              <Link to="/login" onClick={() => setOpen(false)} className="mt-2 rounded-md px-3 py-2.5 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Log in</Link>
              <Link to="/signup" onClick={() => setOpen(false)} className="rounded-md bg-primary px-3 py-2.5 text-center text-base font-medium text-primary-foreground">Create account</Link>
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-3 z-50 px-2 sm:top-4 sm:px-3">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-background/85 px-2.5 shadow-[0_14px_36px_-16px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl sm:h-16 sm:px-4 lg:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold sm:gap-2" aria-label="Carteio AI home">
          Carteio AI
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex" aria-label="Main navigation">
          {navLinks.map((link) => <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">{link.label}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <Search />
          <ThemeToggle />
          <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-semibold sm:h-10 sm:gap-2 sm:px-3 sm:text-sm" asChild>
            <Link to="/signup" aria-label="Get started with Carteio AI">
              <ArrowUpRightIcon className="size-4 shrink-0" aria-hidden="true" />
              <span>Get Started</span>
            </Link>
          </Button>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
