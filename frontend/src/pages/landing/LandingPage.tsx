import { CheckIcon, GaugeIcon, LayersIcon, MoonIcon, MousePointerClickIcon, PaletteIcon, RocketIcon, SparklesIcon, ZapIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Meta } from "@/components/common/Meta";
import "./velora-theme.css";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ActivityList } from "@/components/demo/activity-list";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroMockup } from "@/components/demo/hero-mockup";
import IntegrationsBeam from "@/content/components/animated-beam/examples/default";
import { AnimatedGradientText } from "@/components/velora/animated-gradient-text";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { BentoCard, BentoGrid } from "@/components/velora/bento-grid";
import { BlurFade } from "@/components/velora/blur-fade";
import { BorderBeam } from "@/components/velora/border-beam";
import { Dock, DockIcon } from "@/components/velora/dock";
import { DotPattern, GridPattern } from "@/components/velora/grid-pattern";
import { Marquee } from "@/components/velora/marquee";
import { Meteors } from "@/components/velora/meteors";
import { OrbitingCircles } from "@/components/velora/orbiting-circles";
import { Particles } from "@/components/velora/particles";
import { RetroGrid } from "@/components/velora/retro-grid";
import { ScrollProgress } from "@/components/velora/scroll-progress";
import { ShimmerButton } from "@/components/velora/shimmer-button";
import { SpotlightCard } from "@/components/velora/spotlight-card";
import { TextReveal } from "@/components/velora/text-reveal";
import { TiltCard } from "@/components/velora/tilt-card";
import { Typewriter } from "@/components/velora/typewriter";
import { StackLogo, stackNames } from "@/components/template/stack-logos";

const stats = [
  { value: "Assistants", label: "Configure AI helpers" },
  { value: "Knowledge", label: "Ground answers in sources" },
  { value: "Workflows", label: "Build and test visual flows" },
  { value: "Shopify", label: "Connect supported data" },
];

// Product capabilities shown in the source template's animated card wall.
const capabilities = [
  { quote: "Crawl website pages and manage their availability as business knowledge.", name: "Website knowledge", role: "Carteio capability" },
  { quote: "Configure an AI assistant with workspace instructions and selected sources.", name: "AI assistants", role: "Carteio capability" },
  { quote: "Organize information into knowledge bases for retrieval in assistant workflows.", name: "Knowledge bases", role: "Carteio capability" },
  { quote: "Connect supported Shopify data through the workspace integration flow.", name: "Shopify connection", role: "Carteio capability" },
  { quote: "Build and test flows with assistant, retrieval, and branching steps.", name: "Visual workflows", role: "Carteio capability" },
  { quote: "Choose among supported OpenAI, Gemini, Groq, and OpenRouter providers.", name: "LLM providers", role: "Carteio capability" },
];

const faqs = [
  { q: "What can I build with Carteio AI?", a: "Set up AI assistants, connect business knowledge, and create visual workflows that you can test in your workspace." },
  { q: "Can an assistant use my website content?", a: "You can crawl website pages and organize available content in knowledge bases for retrieval by configured assistants." },
  { q: "Which AI providers are supported?", a: "Current provider options include OpenAI, Google Gemini, Groq, and OpenRouter. Availability depends on workspace configuration." },
  { q: "Does Carteio connect to Shopify?", a: "Carteio includes a Shopify integration for supported commerce data. The workspace guides you through connection permissions." },
];

const freeFeatures = [
  "Configure AI assistants",
  "Crawl and manage website sources",
  "Organize business knowledge",
  "Build and test visual workflows",
  "Connect supported providers",
];

const proFeatures = [
  "Discuss your support workflows",
  "Review knowledge sources and permissions",
  "Explore supported integrations",
  "Plan an assistant setup",
];


export function LandingPage() {
  return (
    <main id="top" className="velora-landing-root dark relative">
      <Meta title="Carteio AI — Business AI with context" description="Configure AI assistants, connect business knowledge, crawl websites, and build visual workflows with Carteio AI." path="/" />
      <ScrollProgress />

      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pt-44 lg:pb-28">
        <AuroraBackground intensity="subtle" />
        <GridPattern
          width={48}
          height={48}
          className="fill-transparent stroke-border/60 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
          <BlurFade delay={0} direction="down">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs backdrop-blur sm:px-4 sm:text-sm">
              <SparklesIcon className="size-3.5 shrink-0 text-primary" />
              <span className="font-medium leading-snug">
                AI assistants grounded in business knowledge
              </span>
            </span>
          </BlurFade>

          <h1 className="mx-auto mt-6 max-w-6xl text-3xl font-semibold leading-[1.08] tracking-tight text-balance sm:mt-8 sm:text-5xl lg:text-6xl">
            <span className="block"><TextReveal text="AI assistants that" /></span>
            <span className="mt-1 block sm:mt-0"><TextReveal text="understand" />{" "}
              <AnimatedGradientText>
                <Typewriter words={["your business.", "your sources.", "your workflows."]} />
              </AnimatedGradientText>
            </span>
          </h1>

          {/* Not faded in: this is the Largest Contentful Paint element, and
              hiding it until hydration costs seconds of LCP on mobile. */}
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground text-pretty sm:mt-6 sm:text-lg">
            Bring your business knowledge into AI assistants and workflows. Crawl
            website sources, organize information for retrieval, and connect
            supported AI providers and commerce data in your workspace.
          </p>

          <BlurFade delay={0.5}>
            <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <ShimmerButton to="/signup" className="w-full px-4 text-xs sm:w-auto sm:px-8 sm:text-sm">
                <RocketIcon className="size-4" />
                Create your workspace
              </ShimmerButton>
              <Button variant="ghost" size="lg" className="w-full sm:w-auto" asChild>
                <a href="#features">Explore the platform</a>
              </Button>
            </div>
          </BlurFade>

          <BlurFade delay={0.6}>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground sm:mt-8 sm:gap-x-5 sm:text-sm">
              {[
                "AI assistants",
                "Website knowledge",
                "Visual workflows",
                "Shopify integration",
              ].map((fact) => (
                <li key={fact} className="flex items-center gap-1.5">
                  <CheckIcon className="size-4 text-primary" />
                  {fact}
                </li>
              ))}
            </ul>
          </BlurFade>

          {/* Product mockup */}
          <BlurFade delay={0.75} offset={32}>
            <HeroMockup className="mt-12 sm:mt-16 lg:mt-20" />
          </BlurFade>

          {/* Stats */}
          <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-8 lg:grid-cols-4">
            {stats.map((stat, i) => (
              <BlurFade key={stat.label} delay={i * 0.1}>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-semibold tracking-tight">{stat.value}</span>
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Logo marquee */}
      <section className="border-y border-border/40 py-12">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <p className="mb-8 text-center text-sm text-muted-foreground">
            Supported AI and commerce connections
          </p>
          <Marquee pauseOnHover className="[--duration:30s]">
            {stackNames.map((name) => (
              <StackLogo
                key={name}
                name={name}
                className="mx-8 text-lg font-semibold tracking-tight text-muted-foreground transition-colors hover:text-foreground"
              />
            ))}
          </Marquee>
        </div>
      </section>

      {/* Bento features */}
      <section id="features" className="relative py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <BlurFade>
            <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
              Business tools to{" "}
              <span className="text-primary">put AI to work</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-muted-foreground">
              Bring assistants, business knowledge, and supported integrations into the workflows your team can configure and inspect.
            </p>
          </BlurFade>

          <BlurFade delay={0.15}>
            <BentoGrid className="mt-16">
              <BentoCard
                name="AI and commerce connections"
                description="Bring supported model providers and Shopify data into your workspace."
                className="md:col-span-1"
                background={
                  <div className="relative flex size-full items-center justify-center pb-20">
                    <ZapIcon className="size-8 text-primary" />
                    <OrbitingCircles radius={90} iconSize={28} duration={24}>
                      <LayersIcon className="size-5 text-muted-foreground" />
                      <PaletteIcon className="size-5 text-muted-foreground" />
                      <GaugeIcon className="size-5 text-muted-foreground" />
                    </OrbitingCircles>
                  </div>
                }
              />
              <BentoCard
                name="Assistant workflows"
                description="Connect business knowledge with configured assistants and workflow steps."
                className="md:col-span-2"
                background={
                  <div className="absolute inset-6 rounded-xl border bg-card/50">
                    <BorderBeam size={72} duration={7} />
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      &lt;BorderBeam /&gt;
                    </div>
                  </div>
                }
              />
              <BentoCard
                name="Business knowledge"
                description="Organize website and business information for assistant retrieval."
                className="md:col-span-2"
                background={
                  <div className="absolute inset-x-10 top-4 bottom-24">
                    <Marquee
                      vertical
                      pauseOnHover
                      className="h-full [--duration:24s]"
                    >
                      {[
                        "Crawl website pages",
                        "Organize knowledge bases",
                        "Configure AI assistants",
                        "Build and test workflows",
                      ].map((quote) => (
                        <div
                          key={quote}
                          className="rounded-xl border bg-card/80 p-4 text-sm text-muted-foreground"
                        >
                          {quote}
                        </div>
                      ))}
                    </Marquee>
                  </div>
                }
              />
              <BentoCard
                name="Source activity"
                description="Review website, knowledge, and assistant activity in context."
                className="md:col-span-1"
                background={
                  <div className="absolute inset-0">
                    <DotPattern className="[mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
                    <Meteors number={10} />
                  </div>
                }
              />
            </BentoGrid>
          </BlurFade>
        </div>
      </section>

      {/* Integrations beam */}
      <section id="integrations" className="relative py-24 lg:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-2 lg:gap-20 lg:px-8">
          <BlurFade direction="right">
            <div>
              <span className="text-sm font-medium text-primary">
                Supported connections
              </span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
                Bring business context{" "}
                <span className="text-primary">into your workflows</span>
              </h2>
              <p className="mt-4 text-muted-foreground">
                Connect supported model providers, website knowledge, and commerce data to the assistants and workflows configured for your workspace.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "Crawl and manage website sources",
                  "Configure OpenAI, Gemini, Groq, or OpenRouter",
                  "Connect supported Shopify data",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <CheckIcon className="size-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </BlurFade>
          <BlurFade direction="left" delay={0.15}>
            <IntegrationsBeam />
          </BlurFade>
        </div>
      </section>

      {/* Live activity */}
      <section id="how-it-works" className="relative overflow-hidden py-24 lg:py-32">
        <RetroGrid />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-2 lg:gap-20 lg:px-8">
          <BlurFade direction="right" className="order-2 lg:order-1">
            <ActivityList />
          </BlurFade>
          <BlurFade
            direction="left"
            delay={0.15}
            className="order-1 lg:order-2"
          >
            <div>
              <span className="text-sm font-medium text-primary">
                Illustrative assistant activity
              </span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
                Review the assistant{" "}
                <span className="text-primary">workflow</span>
              </h2>
              <p className="mt-4 text-muted-foreground">
                Follow an example sequence from an incoming message through knowledge retrieval to an assistant response.
              </p>
              <p className="mt-4 text-muted-foreground">
                Activity shown here is illustrative; workspace details depend on your configured sources and flows.
              </p>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* Spotlight cards */}
      <section className="relative py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: <GaugeIcon className="size-6" />,
                title: "Business knowledge",
                body: "Crawl websites and organize selected information into knowledge bases for retrieval.",
              },
              {
                icon: <MousePointerClickIcon className="size-6" />,
                title: "Configured assistants",
                body: "Set up assistant behavior with the workspace sources and provider configuration available to your team.",
              },
              {
                icon: <MoonIcon className="size-6" />,
                title: "Connected workflows",
                body: "Build and test flows that connect input, retrieval, assistant, and branching steps.",
              },
            ].map((card, i) => (
              <BlurFade key={card.title} delay={i * 0.12}>
                <SpotlightCard className="h-full p-8">
                  <div className="mb-4 w-fit rounded-xl bg-primary/10 p-3 text-primary">
                    {card.icon}
                  </div>
                  <h3 className="text-lg font-semibold">{card.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {card.body}
                  </p>
                </SpotlightCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Product capabilities */}
      <section className="relative py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <BlurFade>
            <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
              Capabilities for your{" "}
              <span className="text-primary">business workflows</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-muted-foreground">
              Examples of the tools and workflows available in Carteio AI.
              Hover the cards: they tilt in 3D.
            </p>
          </BlurFade>
          <div className="mt-16 columns-1 gap-6 md:columns-2 lg:columns-3 [&>*]:mb-6">
            {capabilities.map((t, i) => (
              <BlurFade
                key={t.name}
                delay={(i % 3) * 0.1}
                className="break-inside-avoid"
              >
                <TiltCard>
                  <figure className="rounded-2xl border bg-card p-6">
                    <span className="text-xs font-medium uppercase tracking-wide text-primary">Product capability</span>
                    <p className="mt-4 text-sm text-card-foreground">{t.quote}</p>
                    <figcaption className="mt-4 flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><CheckIcon className="size-4" /></span>
                      <div>
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.role}
                        </p>
                      </div>
                    </figcaption>
                  </figure>
                </TiltCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <BlurFade>
            <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
              Start with Carteio AI
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-muted-foreground">
Create an account to explore the available workspace tools, or contact the team to discuss your business requirements.
            </p>
          </BlurFade>

          <div className="mx-auto mt-16 grid max-w-4xl gap-6 md:grid-cols-2">
            <BlurFade>
              <div className="flex h-full flex-col rounded-2xl border bg-card p-8">
                <h3 className="text-lg font-semibold">Create a workspace</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Set up assistants, business knowledge, and visual workflows in your workspace.
                </p>
                <p className="mt-6 text-3xl font-semibold tracking-tight">Explore Carteio</p>
                <ul className="mt-8 flex-1 space-y-3 text-sm">
                  {freeFeatures.map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <CheckIcon className="size-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="lg" className="mt-8 w-full rounded-full" asChild>
                  <Link to="/signup">Create an account</Link>
                </Button>
              </div>
            </BlurFade>

            <BlurFade delay={0.12}>
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-8">
                <BorderBeam size={80} duration={8} />
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-primary">Talk with our team</h3>
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                    DISCUSS YOUR USE CASE
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Discuss your knowledge sources, integrations, and workflow requirements with the Carteio team.
                </p>
                <p className="mt-6 text-3xl font-semibold tracking-tight">Contact Carteio</p>
                <ul className="mt-8 flex-1 space-y-3 text-sm">
                  {proFeatures.map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <CheckIcon className="size-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="mt-8 w-full rounded-full" asChild><Link to="/help">Contact the team</Link></Button>
              </div>
            </BlurFade>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <BlurFade>
            <h2 className="text-center text-3xl font-semibold tracking-tight lg:text-4xl">
              Frequently asked questions
            </h2>
          </BlurFade>
          <BlurFade delay={0.15}>
            <Accordion type="single" collapsible className="mt-12">
              {faqs.map((faq) => (
                <AccordionItem key={faq.q} value={faq.q}>
                  <AccordionTrigger className="text-left text-base">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </BlurFade>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden py-24 lg:py-32">
        <AuroraBackground intensity="subtle" />
        <Particles quantity={50} />
        <div className="relative mx-auto max-w-4xl px-4 text-center lg:px-8">
          <BlurFade>
            <h2 className="text-4xl font-semibold tracking-tight text-balance lg:text-6xl">
              Bring your business knowledge to AI.
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
              Configure assistants, connect supported tools, and build workflows around your business context.
            </p>
            <div className="mt-10">
              <ShimmerButton to="/signup" className="h-14 px-10 text-base">
                <RocketIcon className="size-5" />
                Start building now
              </ShimmerButton>
            </div>
          </BlurFade>
          <BlurFade delay={0.2}>
            <div className="mt-16">
              <p className="mb-4 text-xs text-muted-foreground">
                Explore the Carteio AI workspace
              </p>
              <Dock>
                <DockIcon label="AI assistants" href="#features"><LayersIcon className="size-5" /></DockIcon>
                <DockIcon label="Website knowledge" href="#integrations"><PaletteIcon className="size-5" /></DockIcon>
                <DockIcon label="Business workflows" href="#how-it-works"><GaugeIcon className="size-5" /></DockIcon>
                <DockIcon label="Shopify integration" href="#integrations"><ZapIcon className="size-5" /></DockIcon>
                <DockIcon label="Frequently asked questions" href="#faq"><MoonIcon className="size-5" /></DockIcon>
                <DockIcon label="Create a workspace" href="/signup"><RocketIcon className="size-5" /></DockIcon>
              </Dock>
            </div>
          </BlurFade>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

export default LandingPage;
