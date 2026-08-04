import type { Metadata } from "next";
import type { CSSProperties } from "react";

import {
  AllReleasesLink,
  Button,
  DetectorCatalog,
  detectorCatalogGroups,
  DownloadPlatformGrid,
  DownloadPrimaryButton,
  HelmLogo,
  KubernetesLogo,
  resolveDetectorGroupId,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { fetchLatestRelease } from "@workspace/ui/lib/releases";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";

import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";
import { CaseGraph } from "@/components/case-graph";
import { EvidenceBoard } from "@/components/evidence-board";
import { Illustration, type IllustrationName } from "@/components/illustration";
import { MissionRing } from "@/components/mission-ring";
import {
  DocsLink,
  SectionHead,
  SectionShell as LandingSectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  SourceCatalogSection,
  SourceMarquee,
} from "@/components/source-showcase";
import {
  demoUrl,
  docs,
  enterpriseContactEmail,
  helmInstallCommand,
  routes,
  softwareVersion,
} from "@/lib/site";

import "./landing.css";

export const metadata: Metadata = {
  title: "The Open-Source Investigation Platform for Your Data",
  description:
    "Classifyre scans the systems you already run, detects secrets, PII, and the signals you define, and works them like a detective — standing inquiries, ranked evidence, cases, and an AI autopilot. Free desktop app for macOS, Windows, and Linux, or a Helm chart on Kubernetes.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Classifyre | Every leak leaves a trail",
    description:
      "An open-source investigation platform. Detectors surface evidence, cases turn it into an investigation, and an AI autopilot works between scans. Runs on your laptop or your Kubernetes cluster.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre | Every leak leaves a trail",
    description:
      "Open-source data investigation: detectors, ranked evidence, cases, and an AI autopilot. Desktop app or Helm chart.",
  },
};

/** The four things a finding turns into once it lands. */
const investigationPillars: readonly {
  illustration: IllustrationName;
  title: string;
  description: string;
  /** Optional deep-dive on the docs site, for the parts that earn one. */
  href?: string;
  hrefLabel?: string;
}[] = [
  {
    illustration: "check-list",
    title: "Inquiries",
    description:
      "Standing questions that keep matching new evidence, scan after scan.",
  },
  {
    illustration: "finger-print",
    title: "Fingerprints",
    description:
      "The same value surfacing in two systems, connected by identity.",
  },
  {
    illustration: "dna",
    title: "Ranked evidence",
    description:
      "Importance from 0 to 1, with written reasons you can argue with.",
    href: docs.ranking,
    hrefLabel: "How ranking works",
  },
  {
    illustration: "binders",
    title: "Cases",
    description:
      "Evidence, competing hypotheses, an owner, and a full audit trail.",
  },
];

/** Custom detection, cheapest rung first. */
const detectorLadder = [
  {
    tier: "01",
    power: 1,
    title: "Regex & rules",
    description: "Deterministic, instant, explainable.",
  },
  {
    tier: "02",
    power: 2,
    title: "Entities & classification",
    description: "Zero-shot, using labels in your words.",
  },
  {
    tier: "03",
    power: 3,
    title: "Any Hugging Face model",
    description: "Open models for text and images.",
  },
  {
    tier: "04",
    power: 4,
    title: "Bring any LLM",
    description: "A prompt becomes a detector.",
  },
] as const;

/** One autopilot cycle, in the order the agents wake. */
const harnessMissions: readonly {
  step: string;
  illustration: IllustrationName;
  title: string;
  description: string;
}[] = [
  {
    step: "01",
    illustration: "check-list",
    title: "Inquiry",
    description: "Matches fresh findings to your standing questions.",
  },
  {
    step: "02",
    illustration: "binders",
    title: "Case",
    description: "Opens cases, drafts hypotheses, attaches evidence.",
  },
  {
    step: "03",
    illustration: "settings",
    title: "Config",
    description: "Wakes up sources that ingest data but find nothing.",
  },
  {
    step: "04",
    illustration: "probe",
    title: "Detector author",
    description: "Writes and dry-runs the detector you were missing.",
  },
  {
    step: "05",
    illustration: "brush",
    title: "Dream",
    description: "Consolidates memory so the next cycle starts grounded.",
  },
];

/** Illustrative cabinet: separate case files on one instance. */
const workspaceFiles = [
  {
    slug: "/acme-corp",
    name: "Acme Corp",
    detail: "12 sources · 3 open cases",
    active: true,
  },
  {
    slug: "/emea-region",
    name: "EMEA Region",
    detail: "5 sources · 1 open case",
    active: false,
  },
  {
    slug: "/internal-audit",
    name: "Internal Audit",
    detail: "8 sources · 6 open cases",
    active: false,
  },
] as const;

/** Everything a workspace owns outright — nothing on this list is shared. */
const workspaceIsolation = [
  "Database schema",
  "Assets & findings",
  "Cases & inquiries",
  "Detectors & sources",
  "Semantic space",
  "Autopilot memory",
  "Scan queue",
  "MCP endpoint",
] as const;

const enterprisePillars = [
  {
    marker: "Governed workspaces",
    description:
      "SSO, roles, and per-workspace authorization — the layer the open-source core deliberately leaves out.",
  },
  {
    marker: "Custom models",
    description:
      "Detection tuned on your terminology, so a term means what it means at your company.",
  },
  {
    marker: "Custom detectors",
    description:
      "Detectors, sources, and multilanguage support built around your industry's data — by our engineers.",
  },
  {
    marker: "Guided rollout",
    description:
      "Architecture reviews, upgrade assistance across Kubernetes and OpenShift, SLA-backed support.",
  },
] as const;

/* ── Small building blocks ─────────────────────────────────────────────── */

function PowerMeter({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn(
            "w-2 border border-border",
            bar <= level ? "bg-accent" : "bg-foreground/10",
          )}
          style={{ height: `${6 + bar * 4}px` }}
        />
      ))}
    </div>
  );
}

function PawPrint({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      style={style}
      fill="currentColor"
    >
      <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
      <ellipse cx="5" cy="9.5" rx="2.2" ry="2.8" />
      <ellipse cx="10" cy="6.5" rx="2.2" ry="2.9" />
      <ellipse cx="14.5" cy="6.8" rx="2.1" ry="2.8" />
      <ellipse cx="19" cy="10" rx="2.1" ry="2.7" />
    </svg>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default async function HomePage() {
  // Resolved once at build time so the exported HTML already carries direct
  // asset links; the download components refresh it in the browser.
  const latestRelease = await fetchLatestRelease();
  const detectorDocs = getAllDetectorDocs();
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
  );
  const activeDetectorItems = detectorDocs
    .filter((detector) => detector.catalogMeta.lifecycleStatus === "active")
    .map((detector) => ({
      id: detector.detectorType,
      type: detector.detectorType,
      title: detector.label,
      description: detector.catalogMeta.notes,
      categories: detector.catalogMeta.categories,
      lifecycleStatus: detector.catalogMeta.lifecycleStatus,
      priority: detector.catalogMeta.priority,
      groupId: resolveDetectorGroupId(
        detector.detectorType,
        detector.catalogMeta.categories,
      ),
      href: `${docs.detectors}${detector.slug}/`,
    }));

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Classifyre",
    applicationCategory: "SecurityApplication",
    operatingSystem: "macOS, Windows, Linux, Kubernetes",
    url: siteUrl,
    description:
      "Classifyre is an open-source investigation platform: detectors surface evidence across modern source systems, findings become inquiries, fingerprints, and cases, and Harness AI works the investigation between scans. Available as a free desktop app for macOS, Windows, and Linux, and as a Helm chart for Kubernetes.",
    offers: [
      {
        "@type": "Offer",
        name: "Classifyre Desktop (macOS, Windows, Linux)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Open Source Core on Kubernetes (Helm)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Enterprise",
        priceSpecification: {
          "@type": "PriceSpecification",
          priceCurrency: "USD",
        },
      },
    ],
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(softwareApplicationSchema),
        }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-title">
        <LandingSectionShell tone="signal" fullWidth className="bg-black">
          <div className="flex flex-col gap-10 text-white lg:flex-row lg:items-center lg:gap-14">
            <div className="space-y-7 lg:flex-[1.35]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center border-2 border-accent bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                  Open source Investigation Platform
                </span>
                <span className="inline-flex items-center border-2 border-white/25 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                  {/* The published release when it could be resolved — the
                      workspace version can be a -SNAPSHOT ahead of it. */}
                  v{latestRelease?.version ?? softwareVersion}
                </span>
              </div>

              <h1
                id="hero-title"
                className="font-hero text-[clamp(4.2rem,11vw,9rem)] font-normal uppercase leading-[0.86] tracking-[0.01em] text-white"
              >
                <span className="block">Every leak</span>
                <span className="block">
                  leaves a{" "}
                  <span className="inline-block bg-accent px-[0.12em] text-black">
                    trail.
                  </span>
                </span>
              </h1>

              <p className="max-w-2xl text-lg leading-8 text-white/78">
                Classifyre scans the systems you already run and detects
                secrets, PII, and the signals you define — then works them like
                a detective, with an AI autopilot doing the legwork between
                scans.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                >
                  <a href="#run-it">Download the app</a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                >
                  <a href={demoUrl} target="_blank" rel="noreferrer">
                    Try the live demo
                  </a>
                </Button>
              </div>
            </div>

            {/* The investigator */}
            <div className="lg:flex-1">
              <div className="relative mx-auto w-52 sm:w-60 lg:w-72">
                <svg
                  viewBox="0 0 300 300"
                  aria-hidden="true"
                  className="absolute -inset-6 h-auto w-[calc(100%+3rem)] text-white/40"
                >
                  <g
                    className="cl-rotate-slow"
                    style={{ transformOrigin: "150px 150px" }}
                  >
                    <circle
                      cx="150"
                      cy="150"
                      r="144"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="16 11"
                    />
                  </g>
                  <g
                    className="cl-rotate-slower"
                    style={{ transformOrigin: "150px 150px" }}
                  >
                    <circle
                      cx="150"
                      cy="150"
                      r="128"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.5"
                      strokeDasharray="3 14"
                      opacity="0.8"
                    />
                  </g>
                </svg>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/clasifyre_icon.png"
                  alt="The Classifyre investigator — a detective cat on a green badge"
                  width={288}
                  height={288}
                  className="relative w-full drop-shadow-[0_0_70px_rgba(183,255,0,0.3)]"
                />
                <div
                  className="cl-stamp absolute -right-8 top-0 border-[3px] border-accent px-2.5 py-1 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-accent"
                  style={{ "--cl-delay": "700ms" } as CSSProperties}
                >
                  Case open
                </div>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Get it running ───────────────────────────────────────────────── */}
      <section aria-labelledby="run-it-title" id="run-it">
        <LandingSectionShell tone="plain" fullWidth>
          <div className="space-y-8">

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Desktop — the primary path */}
              <div className="flex h-full min-w-0 flex-col gap-6 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)] sm:p-8">
                <div className="space-y-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Download · free · no signup
                  </span>
                  <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em] sm:text-3xl">
                    Install it on your machine
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Everything — sources, findings, cases — stays on
                    your machine.
                  </p>
                </div>

                {/* The three platforms, large and unmissable — each tile is
                    the real installer for that OS, not a link to GitHub. */}
                <DownloadPlatformGrid release={latestRelease} />

                <div className="mt-auto space-y-3">
                  <DownloadPrimaryButton release={latestRelease} />
                  <div className="text-center">
                    <AllReleasesLink release={latestRelease} />
                  </div>
                </div>
              </div>

              {/* Kubernetes — the same product, scaled out */}
              <div className="flex h-full min-w-0 flex-col gap-6 border-2 border-foreground bg-foreground p-6 text-primary-foreground shadow-[6px_6px_0_var(--color-accent)] sm:p-8">
                <div className="space-y-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent dark:text-accent-foreground">
                    Helm chart · scales to any size
                  </span>
                  <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em] sm:text-3xl">
                    Or run it on Kubernetes
                  </h3>
                  <p className="text-sm leading-6 text-primary-foreground/72">
                    The same core as a Helm chart, with ephemeral scan workers
                    that scale to zero between runs and fan out as far as your
                    estate goes. Your cluster, your data.
                  </p>
                </div>

                <div className="flex items-center justify-center gap-8 border-2 border-primary-foreground/20 bg-primary-foreground/5 py-6">
                  <KubernetesLogo className="h-14 w-14 text-accent sm:h-16 sm:w-16 dark:text-accent-foreground" />
                  <span
                    aria-hidden="true"
                    className="h-12 w-px bg-primary-foreground/20"
                  />
                  <HelmLogo className="h-14 w-14 text-accent sm:h-16 sm:w-16 dark:text-accent-foreground" />
                </div>

                {/* Tinted with primary-foreground, not black: this card is
                    painted with bg-foreground, which flips with the theme. */}
                <pre className="min-w-0 overflow-x-auto border-2 border-primary-foreground/20 bg-primary-foreground/8 px-3 py-3 font-mono text-[11px] leading-6 text-primary-foreground/85 sm:text-xs">
                  <code>{helmInstallCommand.join("\n")}</code>
                </pre>

                <div className="mt-auto">
                  <DocsLink href={docs.kubernetes} tone="signal">
                    Helm chart docs
                  </DocsLink>
                </div>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── How it works: findings become cases ──────────────────────────── */}
      <section aria-labelledby="investigation-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="investigation-title"
              title={
                <>
                  Findings are evidence.
                  <br />
                  Cases are the product.
                </>
              }
              lede="Most scanners stop at a findings table and wish you luck. Classifyre keeps going — every finding is evidence in an investigation somebody can actually work."
              action={<DocsLink href={docs.howItWorks}>How it works</DocsLink>}
            />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-stretch">
              <Reveal className="border-2 border-border bg-background p-5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  The pipeline
                </span>
                <div className="mt-4">
                  <EvidenceBoard />
                </div>
              </Reveal>

              <figure className="flex min-w-0 flex-col border-2 border-border bg-background p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    A case, assembling itself
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:hidden">
                    Swipe →
                  </span>
                </div>
                {/* The graph is a wide landscape drawing. Squeezed into a phone
                    it scales to ~0.3 and its labels stop being readable, so
                    below `lg` it keeps a legible width and scrolls sideways
                    instead. Bleeds into the figure padding so the scroll edge
                    reads as intentional. */}
                <div className="-mx-5 my-auto overflow-x-auto px-5 py-4 lg:mx-0 lg:overflow-visible lg:px-0">
                  <div className="min-w-142 lg:min-w-0">
                    <CaseGraph />
                  </div>
                </div>
                <figcaption className="border-t-2 border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Hypotheses pinned to severity-rated evidence, a fingerprint
                  match, and autopilot contributions — all attributed.
                </figcaption>
              </figure>
            </div>

            {/* Drawing-led cards: the illustration is the card's subject, so
                it gets its own band above the rule and alternates tilt. */}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {investigationPillars.map((pillar, index) => (
                <Reveal key={pillar.title} as="li" delayMs={index * 80}>
                  <div className="flex h-full flex-col border-2 border-border bg-background shadow-[4px_4px_0_var(--color-border)]">
                    <div className="flex min-h-38 items-center justify-center px-5 py-6">
                      <Illustration
                        name={pillar.illustration}
                        tilt={index % 2 === 0 ? "left" : "right"}
                        className="h-28 w-28"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2 border-t-2 border-border p-5">
                      <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {pillar.title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {pillar.description}
                      </p>
                      {pillar.href ? (
                        <a
                          href={pillar.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-auto pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-foreground/70 underline-offset-4 hover:underline dark:text-accent"
                        >
                          {pillar.hrefLabel} →
                        </a>
                      ) : null}
                    </div>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="sources-title">
        <LandingSectionShell tone="plain" fullWidth>
          <div className="space-y-6">
            <SectionHead
              id="sources-title"
              title="Scan the systems you already own"
              lede="Operational databases, lakehouses, collaboration tools, analytics assets, and public content, all feeding one evidence stream."
              action={<DocsLink href={`${docs.root}/sources/`}>Sources Documentation</DocsLink>}
            />

            <SourceMarquee />


          </div>
        </LandingSectionShell>

        <LandingSectionShell tone="plain" className="border-0">
          <SourceCatalogSection />
        </LandingSectionShell>
      </section>

      {/*/!* ── Detectors: built-in packs + the custom ladder ────────────────── *!/*/}
      {/*<section aria-labelledby="detectors-title">*/}
      {/*  <LandingSectionShell tone="signal">*/}
      {/*    <div className="space-y-8">*/}
      {/*      <SectionHead*/}
      {/*        id="detectors-title"*/}
      {/*        marker="Detectors"*/}
      {/*        tone="signal"*/}
      {/*        illustration="probe"*/}
      {/*        title="Switch one on. Evidence follows."*/}
      {/*        lede="Curated packs for PII, secrets, security, moderation, and quality work on the first scan — no model wrangling."*/}
      {/*      />*/}

      {/*      <DetectorCatalog*/}
      {/*        items={activeDetectorItems}*/}
      {/*        groups={detectorCatalogGroups}*/}
      {/*        external*/}
      {/*      />*/}

      {/*      /!* Custom detection: a ladder, not a leap. *!/*/}
      {/*      <div className="border-2 border-primary-foreground/25 bg-primary-foreground/5">*/}
      {/*        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-primary-foreground/25 px-4 py-3 sm:px-5">*/}
      {/*          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent dark:text-accent-foreground">*/}
      {/*            Need your own? From a regex to any model*/}
      {/*          </span>*/}
      {/*          <a*/}
      {/*            href={docs.customDetectors}*/}
      {/*            target="_blank"*/}
      {/*            rel="noreferrer"*/}
      {/*            className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground/70 underline-offset-4 hover:text-accent hover:underline dark:hover:text-accent-foreground"*/}
      {/*          >*/}
      {/*            Custom detector docs →*/}
      {/*          </a>*/}
      {/*        </div>*/}
      {/*        <ol className="grid divide-y-2 divide-primary-foreground/20 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x-2">*/}
      {/*          {detectorLadder.map((rung) => (*/}
      {/*            <li*/}
      {/*              key={rung.tier}*/}
      {/*              className="flex flex-col gap-2 p-4 sm:p-5"*/}
      {/*            >*/}
      {/*              <div className="flex items-center justify-between">*/}
      {/*                <span className="font-mono text-2xl font-black text-primary-foreground/20">*/}
      {/*                  {rung.tier}*/}
      {/*                </span>*/}
      {/*                <PowerMeter level={rung.power} />*/}
      {/*              </div>*/}
      {/*              <p className="font-serif text-sm font-black uppercase leading-tight tracking-[0.04em]">*/}
      {/*                {rung.title}*/}
      {/*              </p>*/}
      {/*              <p className="text-xs leading-5 text-primary-foreground/65">*/}
      {/*                {rung.description}*/}
      {/*              </p>*/}
      {/*            </li>*/}
      {/*          ))}*/}
      {/*        </ol>*/}
      {/*      </div>*/}
      {/*    </div>*/}
      {/*  </LandingSectionShell>*/}
      {/*</section>*/}

      {/* ── Autopilot ────────────────────────────────────────────────────── */}
      {/*<section aria-labelledby="harness-title">*/}
      {/*  <LandingSectionShell tone="signal">*/}
      {/*    <div className="space-y-8">*/}
      {/*      <SectionHead*/}
      {/*        id="harness-title"*/}
      {/*        marker="Harness AI"*/}
      {/*        tone="signal"*/}
      {/*        title={*/}
      {/*          <>*/}
      {/*            Autopilot,{" "}*/}
      {/*            <span className="inline-block bg-accent px-[0.14em] text-black">*/}
      {/*              not copilot*/}
      {/*            </span>*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="Nobody has to type a prompt. After every scan five agents wake in sequence and move the investigation forward — each one logging what it did and why."*/}
      {/*        action={*/}
      {/*          <DocsLink href={docs.autopilot} tone="signal">*/}
      {/*            Autopilot docs*/}
      {/*          </DocsLink>*/}
      {/*        }*/}
      {/*      />*/}

      {/*      /!* The ring is the poster; the five drawings below are the cast.*/}
      {/*          Giving each agent its own full-size illustration beats cramming*/}
      {/*          them into a two-column list of thumbnails. *!/*/}
      {/*      <div className="flex flex-col items-center gap-4">*/}
      {/*        <MissionRing />*/}
      {/*        <p className="max-w-md text-center font-mono text-[10px] uppercase leading-5 tracking-[0.14em] text-primary-foreground/55">*/}
      {/*          Flip observe-only and it proposes without touching a thing*/}
      {/*        </p>*/}
      {/*      </div>*/}

      {/*      <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">*/}
      {/*        {harnessMissions.map((mission, index) => (*/}
      {/*          <Reveal key={mission.step} as="li" delayMs={index * 80}>*/}
      {/*            <div className="flex h-full flex-col items-center gap-4 border-2 border-primary-foreground/25 bg-primary-foreground/8 p-5 text-center">*/}
      {/*              <Illustration*/}
      {/*                name={mission.illustration}*/}
      {/*                surface="inverted"*/}
      {/*                tilt={index % 2 === 0 ? "left" : "right"}*/}
      {/*                className="h-24 w-24"*/}
      {/*              />*/}
      {/*              <div className="flex items-baseline gap-2">*/}
      {/*                <span className="font-mono text-[10px] font-bold text-accent dark:text-accent-foreground">*/}
      {/*                  {mission.step}*/}
      {/*                </span>*/}
      {/*                <span className="font-mono text-xs font-bold uppercase tracking-[0.14em]">*/}
      {/*                  {mission.title}*/}
      {/*                </span>*/}
      {/*              </div>*/}
      {/*              <p className="text-xs leading-5 text-primary-foreground/68">*/}
      {/*                {mission.description}*/}
      {/*              </p>*/}
      {/*            </div>*/}
      {/*          </Reveal>*/}
      {/*        ))}*/}
      {/*      </ol>*/}
      {/*    </div>*/}
      {/*  </LandingSectionShell>*/}
      {/*</section>*/}

      {/* ── Workspaces ───────────────────────────────────────────────────── */}
      {/*<section aria-labelledby="workspaces-title">*/}
      {/*  <LandingSectionShell tone="plain">*/}
      {/*    <div className="space-y-8">*/}
      {/*      <SectionHead*/}
      {/*        id="workspaces-title"*/}
      {/*        marker="Isolated workspaces"*/}
      {/*        title={*/}
      {/*          <>*/}
      {/*            One instance.*/}
      {/*            <br />*/}
      {/*            Sealed case files.*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="A client, a region, a business unit — each gets its own PostgreSQL schema, evidence, AI memory, and endpoint. A wall, not a tenant column somebody can forget to filter on."*/}
      {/*        action={*/}
      {/*          <DocsLink href={docs.workspaces}>Workspace docs</DocsLink>*/}
      {/*        }*/}
      {/*      />*/}

      {/*      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">*/}
      {/*        /!* The cabinet: tabbed case files, stacked and sealed. *!/*/}
      {/*        <figure className="relative">*/}
      {/*          <ol className="flex flex-col">*/}
      {/*            {workspaceFiles.map((file, index) => (*/}
      {/*              <Reveal key={file.slug} as="li" delayMs={index * 120}>*/}
      {/*                {index > 0 ? (*/}
      {/*                  <div*/}
      {/*                    className="flex items-center gap-3 py-3"*/}
      {/*                    aria-hidden="true"*/}
      {/*                  >*/}
      {/*                    <span className="h-px flex-1 border-t-2 border-dashed border-border/50" />*/}
      {/*                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground">*/}
      {/*                      No crossover*/}
      {/*                    </span>*/}
      {/*                    <span className="h-px flex-1 border-t-2 border-dashed border-border/50" />*/}
      {/*                  </div>*/}
      {/*                ) : null}*/}

      {/*                <div className="cl-file">*/}
      {/*                  <div*/}
      {/*                    className="cl-file-tab flex"*/}
      {/*                    style={*/}
      {/*                      {*/}
      {/*                        "--cl-tab-offset": `${index * 28}%`,*/}
      {/*                      } as CSSProperties*/}
      {/*                    }*/}
      {/*                  >*/}
      {/*                    <span*/}
      {/*                      className={cn(*/}
      {/*                        "border-2 border-b-0 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",*/}
      {/*                        file.active*/}
      {/*                          ? "border-accent bg-accent text-black"*/}
      {/*                          : "border-border bg-foreground/5 text-muted-foreground",*/}
      {/*                      )}*/}
      {/*                    >*/}
      {/*                      {file.slug}*/}
      {/*                    </span>*/}
      {/*                  </div>*/}

      {/*                  <div*/}
      {/*                    className={cn(*/}
      {/*                      "flex items-center justify-between gap-3 border-2 p-4",*/}
      {/*                      file.active*/}
      {/*                        ? "border-accent bg-accent/10"*/}
      {/*                        : "border-border bg-background",*/}
      {/*                    )}*/}
      {/*                  >*/}
      {/*                    <div className="min-w-0">*/}
      {/*                      <p className="truncate font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">*/}
      {/*                        {file.name}*/}
      {/*                      </p>*/}
      {/*                      <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">*/}
      {/*                        {file.detail}*/}
      {/*                      </p>*/}
      {/*                    </div>*/}
      {/*                    <span className="shrink-0 border border-border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">*/}
      {/*                      Sealed*/}
      {/*                    </span>*/}
      {/*                  </div>*/}
      {/*                </div>*/}
      {/*              </Reveal>*/}
      {/*            ))}*/}
      {/*          </ol>*/}
      {/*        </figure>*/}

      {/*        <div className="border-2 border-border bg-background">*/}
      {/*          <div className="border-b-2 border-border px-4 py-3 sm:px-5">*/}
      {/*            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent-foreground/70 dark:text-accent">*/}
      {/*              Not shared. Ever.*/}
      {/*            </span>*/}
      {/*          </div>*/}
      {/*          <ul className="grid grid-cols-2 gap-px bg-border">*/}
      {/*            {workspaceIsolation.map((item) => (*/}
      {/*              <li*/}
      {/*                key={item}*/}
      {/*                className="bg-background px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground"*/}
      {/*              >*/}
      {/*                <span className="mr-1.5 text-accent-foreground/70 dark:text-accent">*/}
      {/*                  ▪*/}
      {/*                </span>*/}
      {/*                {item}*/}
      {/*              </li>*/}
      {/*            ))}*/}
      {/*          </ul>*/}
      {/*        </div>*/}
      {/*      </div>*/}
      {/*    </div>*/}
      {/*  </LandingSectionShell>*/}
      {/*</section>*/}

      {/* ── Enterprise ───────────────────────────────────────────────────── */}
      {/* The accent frame is this section's own border — it skips the shared
          shell so the two don't nest into a card-in-a-card. */}
      {/*<section aria-labelledby="enterprise-title">*/}
      {/*  <div className="relative overflow-hidden rounded-[8px] border-2 border-accent bg-background">*/}
      {/*    <div className="landing-grid absolute inset-0 opacity-20" />*/}
      {/*    <div className="relative space-y-6 p-6 py-10 sm:p-8 sm:py-12 lg:py-16">*/}
      {/*      <SectionHead*/}
      {/*        id="enterprise-title"*/}
      {/*        marker="Enterprise"*/}
      {/*        illustration="people"*/}
      {/*        title={*/}
      {/*          <>*/}
      {/*            A partnership,*/}
      {/*            <br />*/}
      {/*            not a license key*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="Our engineers work with your team from the first pilot — learning how your business names things and tuning Classifyre to how your company actually works."*/}
      {/*      />*/}

      {/*      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">*/}
      {/*        {enterprisePillars.map((pillar, index) => (*/}
      {/*          <Reveal key={pillar.marker} delayMs={index * 80}>*/}
      {/*            <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-4">*/}
      {/*              <p className="font-serif text-sm font-black uppercase leading-tight tracking-[0.04em]">*/}
      {/*                {pillar.marker}*/}
      {/*              </p>*/}
      {/*              <p className="text-sm leading-6 text-muted-foreground">*/}
      {/*                {pillar.description}*/}
      {/*              </p>*/}
      {/*            </div>*/}
      {/*          </Reveal>*/}
      {/*        ))}*/}
      {/*      </div>*/}

      {/*      <div className="flex flex-wrap items-center gap-4">*/}
      {/*        <Button*/}
      {/*          asChild*/}
      {/*          className="border-2 border-accent bg-accent text-accent-foreground hover:bg-accent/90"*/}
      {/*        >*/}
      {/*          <a href={`mailto:${enterpriseContactEmail}`}>*/}
      {/*            Start the conversation*/}
      {/*          </a>*/}
      {/*        </Button>*/}
      {/*        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">*/}
      {/*          {enterpriseContactEmail}*/}
      {/*        </span>*/}
      {/*      </div>*/}
      {/*    </div>*/}
      {/*  </div>*/}
      {/*</section>*/}


      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section aria-labelledby="closing-title">
        <LandingSectionShell tone="signal" fullWidth className="bg-black">
          <div className="relative text-white">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 justify-between px-8 text-white/15 lg:flex"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                <PawPrint
                  key={index}
                  className="cl-paw h-7 w-7"
                  style={
                    {
                      transform: `rotate(${index % 2 === 0 ? 18 : -12}deg) translateY(${index % 2 === 0 ? -14 : 14}px)`,
                      "--cl-delay": `${index * 120}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 py-6 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/clasifyre_icon.png"
                alt=""
                width={72}
                height={72}
                className="w-16 drop-shadow-[0_0_40px_rgba(183,255,0,0.35)]"
              />
              <h2
                id="closing-title"
                className="font-hero text-[clamp(3rem,8vw,6rem)] uppercase leading-[0.88] tracking-[0.01em]"
              >
                Open your first case{" "}
                <span className="inline-block bg-accent px-[0.12em] text-black">
                  tonight.
                </span>
              </h2>
              <p className="max-w-xl text-base leading-7 text-white/70">
                Download it, point it at a system you already run, and see what
                the investigator finds. Everything you build carries over when
                you go remote with Helm.
              </p>
              <div className="flex w-full flex-wrap items-start justify-center gap-3">
                <div className="w-full max-w-xs">
                  {/* Dark section: the caption under the button inherits
                      muted-foreground, which reads on white — force it light. */}
                  <div className="[&_p]:text-white/55">
                    <DownloadPrimaryButton release={latestRelease} />
                  </div>
                </div>
                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                >
                  <a href={demoUrl} target="_blank" rel="noreferrer">
                    Try the live demo
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>
    </main>
  );
}
