import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  to?: string;
}

export function ShimmerButton({
  className,
  children,
  to,
  ...props
}: ShimmerButtonProps) {
  const classNames = cn(
        "group/shimmer relative inline-flex h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow] duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]",
        className
      );
  const content = <>
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      <span aria-hidden className="motion-safe:animate-shimmer absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)] bg-[length:250%_100%]" />
    </>;
  if (to) return <Link to={to} className={classNames}>{content}</Link>;
  return (
    <button
      data-slot="shimmer-button"
      className={classNames}
      {...props}
    >
      {content}
    </button>
  );
}
