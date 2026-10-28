import React, { createContext, useContext, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type AccordionContextValue = { value: string | null; setValue: (value: string | null) => void };
const AccordionContext = createContext<AccordionContextValue | null>(null);

export function Accordion({ children, className }: { children: React.ReactNode; className?: string; type?: 'single'; collapsible?: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  return <AccordionContext.Provider value={{ value, setValue }}><div className={cn('flex w-full flex-col', className)}>{children}</div></AccordionContext.Provider>;
}

export function AccordionItem({ children, value, className }: { children: React.ReactNode; value: string; className?: string }) {
  return <AccordionItemContext.Provider value={value}><div data-slot="accordion-item" className={cn('border-b border-border', className)} data-open={useContext(AccordionContext)?.value === value}>{children}</div></AccordionItemContext.Provider>;
}

export function AccordionTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  const accordion = useContext(AccordionContext);
  const item = useContext(AccordionItemContext);
  const active = accordion?.value === item;
  return <button type="button" aria-expanded={active} className={cn('group flex w-full items-start justify-between gap-4 py-4 text-left text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50', className)} onClick={() => accordion?.setValue(active ? null : item ?? null)}>{children}<ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', active && 'rotate-180')} /></button>;
}

const AccordionItemContext = createContext<string | null>(null);

export function AccordionContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const accordion = useContext(AccordionContext);
  const item = useContext(AccordionItemContext);
  if (accordion?.value !== item) return null;
  return <div data-slot="accordion-content" className={cn('overflow-hidden pb-4 text-sm text-muted-foreground', className)}>{children}</div>;
}
