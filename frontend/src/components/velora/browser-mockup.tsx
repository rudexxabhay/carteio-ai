import { cn } from "@/lib/utils";

interface BrowserMockupProps extends React.HTMLAttributes<HTMLDivElement> {
  url?: string;
  children: React.ReactNode;
}

/**
 * Browser window frame — traffic lights, URL bar, your content inside.
 */
export function BrowserMockup({
  url = "velora.dev",
  className,
  children,
  ...props
}: BrowserMockupProps) {
  return (
    <div
      data-slot="browser-mockup"
      className={cn(
        "overflow-hidden rounded-2xl border bg-card/80 shadow-2xl backdrop-blur",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-500/70" />
          <span className="size-3 rounded-full bg-yellow-500/70" />
          <span className="size-3 rounded-full bg-green-500/70" />
        </div>
        <div className="mx-auto flex h-7 w-64 items-center justify-center rounded-md bg-muted/60 text-xs text-muted-foreground">
          {url}
        </div>
        <div className="w-14" />
      </div>
      {children}
    </div>
  );
}
