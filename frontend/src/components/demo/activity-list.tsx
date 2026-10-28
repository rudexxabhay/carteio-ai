"use client";

import {
  BotIcon,
  DatabaseIcon,
  GlobeIcon,
  MessageSquareIcon,
  WorkflowIcon,
  PlugZapIcon,
} from "lucide-react";

import { AnimatedList } from "@/components/velora/animated-list";
import { cn } from "@/lib/utils";

const notifications = [
  {
    icon: GlobeIcon,
    tone: "bg-emerald-500/15 text-emerald-500",
    title: "Website source",
    description: "Illustrative crawl activity",
    time: "Example",
  },
  {
    icon: DatabaseIcon,
    tone: "bg-blue-500/15 text-blue-500",
    title: "Knowledge base",
    description: "Example source organization",
    time: "Example",
  },
  {
    icon: PlugZapIcon,
    tone: "bg-amber-500/15 text-amber-500",
    title: "Provider setup",
    description: "Supported model connection",
    time: "Example",
  },
  {
    icon: MessageSquareIcon,
    tone: "bg-violet-500/15 text-violet-500",
    title: "Assistant response",
    description: "Example grounded response",
    time: "Example",
  },
  {
    icon: WorkflowIcon,
    tone: "bg-pink-500/15 text-pink-500",
    title: "Workflow test",
    description: "Example run with retrieval step",
    time: "Example",
  },
  {
    icon: BotIcon,
    tone: "bg-cyan-500/15 text-cyan-500",
    title: "Shopify connection",
    description: "Supported commerce data",
    time: "Example",
  },
];

/**
 * Looping notification feed built on <AnimatedList />.
 */
export function ActivityList({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-[26rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]",
        className
      )}
    >
      <AnimatedList delay={1800}>
        {notifications.map((n) => (
          <div
            key={n.title}
            className="flex items-center gap-4 rounded-2xl border bg-card/80 p-4 shadow-sm backdrop-blur"
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                n.tone
              )}
            >
              <n.icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between gap-2 text-sm font-medium">
                {n.title}
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {n.time}
                </span>
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {n.description}
              </p>
            </div>
          </div>
        ))}
      </AnimatedList>
    </div>
  );
}
