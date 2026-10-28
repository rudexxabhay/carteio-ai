import { cn } from '@/lib/utils';

const stackNames = ['OpenAI', 'Google Gemini', 'Groq', 'OpenRouter', 'Shopify', 'Website sources'];

export function StackLogo({ name, className }: { name: string; className?: string }) {
  return <span className={cn('inline-flex items-center gap-2.5', className)}><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />{name}</span>;
}

export { stackNames };
