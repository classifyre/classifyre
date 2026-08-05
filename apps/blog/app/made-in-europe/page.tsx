import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  demoUrl,
  releasesLatestUrl,
  docs,
  enterpriseContactEmail,
  repoUrl,
  routes,
} from "@/lib/site";

import "../landing.css";

export const metadata: Metadata = {
  title: "Made in Austria",
  description:
    "Classifyre is built in Austria, in the European Union, and released as open source under Apache-2.0. The software runs on your own machines — your data stays where you put it, under the rules we work under ourselves.",
  alternates: { canonical: routes.madeInEurope },
  openGraph: {
    title: "Classifyre — Made in Austria, built in the open",
    description:
      "An Austrian, European, Apache-2.0 open-source investigation platform. Your data never has to leave your infrastructure — or the continent.",
    type: "website",
  },
};

/**
 * The Austrian flag as three painted bars rather than an emoji or a PNG: the
 * site's whole visual language is 2px borders and flat blocks, and a glossy
 * flag graphic would read as a sticker dropped onto a case file. Decorative —
 * the surrounding copy already says "Austria" in words.
 */
function AustrianFlag({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-12 w-16 flex-col overflow-hidden border-2 border-border",
        className,
      )}
    >
      <span className="h-1/3 w-full bg-[#ed2939]" />
      <span className="h-1/3 w-full bg-white" />
      <span className="h-1/3 w-full bg-[#ed2939]" />
    </span>
  );
}

/**
 * The twelve stars, drawn on a circle rather than hand-placed. Real polygons
 * rather than the ★ glyph: a text star would land in the page's copied text
 * and in anything scraping it, twelve times over, for a purely decorative mark.
 */
const STAR_POINTS = [
  [0, -1],
  [0.2245, -0.309],
  [0.951, -0.309],
  [0.363, 0.118],
  [0.588, 0.809],
  [0, 0.382],
  [-0.588, 0.809],
  [-0.363, 0.118],
  [-0.951, -0.309],
  [-0.2245, -0.309],
]
  .map(([x, y]) => `${x},${y}`)
  .join(" ");

function EuropeanStars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("h-12 w-12", className)}
    >
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * Math.PI) / 6 - Math.PI / 2;
        const x = 50 + 32 * Math.cos(angle);
        const y = 50 + 32 * Math.sin(angle);
        return (
          <polygon
            key={index}
            points={STAR_POINTS}
            fill="currentColor"
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(9)`}
          />
        );
      })}
    </svg>
  );
}

/** What the address actually changes for someone running the software. */
const consequences: readonly {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}[] = [
  {
    marker: "Residency",
    title: "Your data never has to leave the building",
    body: "Classifyre is software you install, not a service you upload to. The desktop build keeps everything on one machine; the Helm chart keeps everything inside your cluster. There is no vendor tenancy to pick a region for, because there is no vendor tenancy.",
    href: docs.deployment,
    hrefLabel: "Deployment options",
  },
  {
    marker: "Sovereignty",
    title: "No dependency on a non-EU cloud",
    body: "Nothing in the stack requires a hyperscaler account. PostgreSQL and Kubernetes are the only hard dependencies, so the whole platform runs on an EU provider, on-premises hardware, or an air-gapped rack — the same build either way.",
    href: docs.kubernetes,
    hrefLabel: "Run it on Kubernetes",
  },
  {
    marker: "AI on your terms",
    title: "You choose the model, and where it runs",
    body: "AI providers are configuration, not a hardwired vendor. Point the autopilot and the LLM detectors at a European endpoint, at a model you host yourself, or at nothing at all — the rule-based and local-model detectors work without any provider configured.",
    href: docs.aiProviders,
    hrefLabel: "AI providers",
  },
  {
    marker: "Same rulebook",
    title: "We work under the regulations you do",
    body: "GDPR, NIS2, DORA, and the AI Act are not an export checklist for us — they are the law where we sit. That shapes the product's defaults: audit trails on cases, encrypted credentials, workspace isolation, and telemetry you can switch off.",
    href: docs.telemetry,
    hrefLabel: "What telemetry sends",
  },
];

/** Why the open-source part is a commitment rather than a marketing tier. */
const openSourceFacts: readonly {
  label: string;
  value: string;
  detail: string;
}[] = [
  {
    label: "License",
    value: "Apache-2.0",
    detail:
      "Permissive, patent-granting, and boring on purpose. Fork it, ship it, run it commercially.",
  },
  {
    label: "Scope",
    value: "The whole engine",
    detail:
      "Connectors, detectors, investigations, autopilot, desktop app, and Helm chart — not a stripped demo.",
  },
  {
    label: "Development",
    value: "In the open",
    detail:
      "Issues, pull requests, and releases all happen on the public repository, in public.",
  },
];

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex h-full flex-col gap-2 border-2 border-white/20 bg-white/[0.04] p-5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
        {label}
      </span>
      <p className="font-serif text-xl font-black uppercase leading-tight tracking-[0.04em] text-white">
        {value}
      </p>
      <p className="text-sm leading-6 text-white/70">{detail}</p>
    </div>
  );
}

function Consequence({
  marker,
  title,
  body,
  href,
  hrefLabel,
}: {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
      <Marker label={marker} />
      <h3 className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
        {title}
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      {href && hrefLabel ? (
        <div className="mt-auto pt-2">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-accent-foreground hover:underline dark:hover:text-accent"
          >
            {hrefLabel} →
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** One line of the "where we sit" card stack. */
function Coordinate({
  label,
  value,
  aside,
}: {
  label: string;
  value: string;
  aside: ReactNode;
}) {
  return (
    <div className="flex items-center gap-5 border-2 border-border bg-background p-5">
      <div className="shrink-0">{aside}</div>
      <div className="space-y-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
          {value}
        </p>
      </div>
    </div>
  );
}

export default function MadeInEuropePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Servus"
        title={
          <>
            Made in Austria.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Open to everyone.
            </span>
          </>
        }
        lede={
          <>
            Classifyre is built in Austria, in the European Union, and released
            as open source under Apache-2.0. We are not a European brand on top
            of somebody else&apos;s cloud — the software runs on your machines,
            under the same rules we work under ourselves.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={repoUrl} target="_blank" rel="noreferrer">
                Read the source
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={routes.download}>Download</a>
            </Button>
          </>
        }
        aside={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4 border-2 border-white/20 bg-white/[0.04] p-5">
              <AustrianFlag className="shrink-0" />
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                  Built in
                </p>
                <p className="font-serif text-xl font-black uppercase tracking-[0.04em] text-white">
                  Austria
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 border-2 border-white/20 bg-white/[0.04] p-5">
              <EuropeanStars className="shrink-0 text-accent" />
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                  Under the rules of
                </p>
                <p className="font-serif text-xl font-black uppercase tracking-[0.04em] text-white">
                  The European Union
                </p>
              </div>
            </div>
          </div>
        }
      />

      {/* ── Where we sit ─────────────────────────────────────────────────── */}
      <section aria-labelledby="where-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="where-title"
              marker="Coordinates"
              illustration="feet"
              title="A small European team, working in public"
              lede="No offshore development shop, no anonymous maintainer account."
            />

            <div className="flex flex-wrap items-center gap-4 border-2 border-border bg-muted/30 p-5">
              <Marker label="Say hello" />
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Questions about a rollout, a connector you need, or where the
                project is going next? Write to us — the same address reaches
                the people who wrote the code.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  {enterpriseContactEmail}
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── What it changes for you ──────────────────────────────────────── */}
      <section aria-labelledby="consequences-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="consequences-title"
              marker="What it changes"
              illustration="binders"
              title="Being European"
              lede="Plenty of tools claim EU hosting and then ask you to ship your most sensitive data to them anyway. Classifyre is built the other way round: the software travels to the data."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              {consequences.map((item, index) => (
                <Reveal key={item.marker} delayMs={index * 80} className="h-full">
                  <Consequence {...item} />
                </Reveal>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-2 border-border bg-background p-5">
              <Marker label="Straight answer" />
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                We are not going to tell you a piece of software makes you
                GDPR-compliant — no software does that. What we can say is that
                Classifyre never needs a copy of your data, and that every
                design decision above was made so a European compliance review
                is a short conversation instead of a project.
              </p>
              <DocsLink href={docs.deployment}>Deployment docs</DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Open source ──────────────────────────────────────────────────── */}
      <section aria-labelledby="open-source-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="space-y-8 text-white">

            <div className="grid gap-3 md:grid-cols-3">
              {openSourceFacts.map((fact) => (
                <Fact key={fact.label} {...fact} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                asChild
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={repoUrl} target="_blank" rel="noreferrer">
                  Browse the repository
                </a>
              </Button>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={routes.editions}>Open source vs Enterprise</a>
              </Button>
              <a
                href={demoUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
              >
                Or poke at the live demo
              </a>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="europe-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <div className="flex items-center gap-4">
              <AustrianFlag className="h-10 w-14 border-white/30" />
              <EuropeanStars className="h-10 w-10 text-accent" />
            </div>
            <h2
              id="europe-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Built here.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Run anywhere.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Download the desktop app and point it at something real. Nothing
              is uploaded, nothing phones a foreign cloud, and everything you
              build carries over when you move to Kubernetes.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={releasesLatestUrl} target="_blank" rel="noreferrer">
                  Download Classifyre
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>Talk to us</a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
