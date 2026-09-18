import type { Metadata } from "next";
import type { CSSProperties } from "react";

import {
  Button,
  DetectorCatalog,
  detectorCatalogGroups,
  DockerLogo,
  DockerRunBlock,
  dockerImageTag,
  dockerRunLines,
  HelmLogo,
  KubernetesLogo,
  resolveDetectorGroupId,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";

import { getDockerNotes } from "@/i18n";
import deTranslations from "@/i18n/de.json";
import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";
import { CaseGraph } from "@/components/case-graph";
import { ClosingBoard } from "@/components/closing-board";
import { EvidenceBoard } from "@/components/evidence-board";
import { HeroBoard } from "@/components/hero-board";
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
  docs,
  enterpriseContactEmail,
  helmInstallCommand,
  repoUrl,
  routes,
  showcaseUrlFor,
  softwareVersion,
} from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Die Open-Source-Ermittlungsplattform für Ihre Daten",
  description:
    "Classifyre liest die Systeme, die Sie bereits betreiben, findet die von Ihnen definierten Signale — ein Unternehmen vor der Insolvenz, eine Sendung an die falsche Adresse, ein geleaktes Credential — und verfolgt sie: Lineage über Quellen hinweg, stehende Anfragen, gereihte Beweise, Fälle und ein KI-Autopilot. Ein Docker-Image für macOS, Windows oder Linux, oder ein Helm-Chart für Kubernetes.",
  alternates: {
    canonical: "/de/",
    languages: {
      en: "/",
      de: "/de/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: "Classifyre | Verstreute Daten rein, geschlossene Fälle raus",
    description:
      "Eine Open-Source-Ermittlungsplattform. Detektoren und Tags heben Beweise hervor, Lineage verbindet sie über Quellen hinweg, Fälle machen daraus eine Ermittlung, und ein KI-Autopilot arbeitet zwischen den Scans. Läuft auf Ihrem Laptop oder Ihrem Kubernetes-Cluster.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre | Verstreute Daten rein, geschlossene Fälle raus",
    description:
      "Open-Source-Datenermittlung: Detektoren, Lineage, gereihte Beweise, Fälle und ein KI-Autopilot. Ein Docker-Image oder ein Helm-Chart.",
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
    title: "Anfragen",
    description:
      "Stehende Fragen, die Scan für Scan weiter neue Beweise matchen.",
    href: docs.inquiry,
    hrefLabel: "So funktionieren Anfragen",
  },
  {
    illustration: "docs",
    title: "Duplikate",
    description:
      "Eine abschließbare Review-Queue für Near-Duplicates — nach Ursache gruppiert, Paar für Paar beurteilt.",
    href: docs.duplicates,
    hrefLabel: "So funktioniert die Duplikatprüfung",
  },
  {
    illustration: "dna",
    title: "Gereihte Beweise",
    description:
      "Wichtigkeit von 0 bis 1, mit aufgeschriebenen Gründen, denen Sie widersprechen können.",
    href: docs.ranking,
    hrefLabel: "So funktioniert das Ranking",
  },
  {
    illustration: "binders",
    title: "Fälle",
    description:
      "Beweise, konkurrierende Hypothesen, ein Owner und ein vollständiger Audit-Trail.",
    href: docs.cases,
    hrefLabel: "So funktionieren Fälle",
  },
];

/** Custom detection, cheapest rung first. */
const detectorLadder = [
  {
    tier: "01",
    power: 1,
    title: "Regex & Regeln",
    description: "Deterministisch, sofort, erklärbar.",
  },
  {
    tier: "02",
    power: 2,
    title: "Entitäten & Klassifizierung",
    description: "Zero-Shot, mit Labels in Ihren Worten.",
  },
  {
    tier: "03",
    power: 3,
    title: "Jedes Hugging-Face-Modell",
    description: "Offene Modelle für Text und Bilder.",
  },
  {
    tier: "04",
    power: 4,
    title: "Jedes LLM mitbringen",
    description: "Ein Prompt wird zum Detektor.",
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
    title: "Anfrage",
    description: "Matcht frische Befunde auf Ihre stehenden Fragen.",
  },
  {
    step: "02",
    illustration: "binders",
    title: "Fall",
    description: "Eröffnet Fälle, entwirft Hypothesen, hängt Beweise an.",
  },
  {
    step: "03",
    illustration: "settings",
    title: "Konfiguration",
    description: "Weckt Quellen, die Daten aufnehmen, aber nichts finden.",
  },
  {
    step: "04",
    illustration: "probe",
    title: "Detektor-Autor",
    description: "Schreibt den Detektor, der Ihnen fehlte, und dry-runnt ihn.",
  },
  {
    step: "05",
    illustration: "brush",
    title: "Dream",
    description: "Konsolidiert Memory, damit der nächste Zyklus geerdet startet.",
  },
];

/** Illustrative cabinet: separate case files on one instance. */
const workspaceFiles = [
  {
    slug: "/acme-corp",
    name: "Acme Corp",
    detail: "12 Quellen · 3 offene Fälle",
    active: true,
  },
  {
    slug: "/emea-region",
    name: "EMEA Region",
    detail: "5 Quellen · 1 offener Fall",
    active: false,
  },
  {
    slug: "/internal-audit",
    name: "Interne Revision",
    detail: "8 Quellen · 6 offene Fälle",
    active: false,
  },
] as const;

/** Everything a workspace owns outright — nothing on this list is shared. */
const workspaceIsolation = [
  "Datenbank-Schema",
  "Assets & Befunde",
  "Fälle & Anfragen",
  "Detektoren & Quellen",
  "Semantischer Raum",
  "Autopilot-Memory",
  "Scan-Queue",
  "MCP-Endpunkt",
] as const;

const enterprisePillars = [
  {
    marker: "Gesteuerte Workspaces",
    description:
      "SSO, Rollen und Autorisierung pro Workspace — die Schicht, die der Open-Source-Kern bewusst auslässt.",
  },
  {
    marker: "Eigene Modelle",
    description:
      "Detektion, abgestimmt auf Ihre Terminologie — damit ein Begriff bedeutet, was er in Ihrer Firma bedeutet.",
  },
  {
    marker: "Eigene Detektoren",
    description:
      "Detektoren, Quellen und Mehrsprachen-Support rund um die Daten Ihrer Branche — gebaut von unseren Engineers.",
  },
  {
    marker: "Begleiteter Rollout",
    description:
      "Architektur-Reviews, Upgrade-Hilfe über Kubernetes und OpenShift, Support mit SLA.",
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

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function HomePageDe() {
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
    applicationCategory: "BusinessApplication",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes",
    url: siteUrl,
    description:
      "Classifyre ist eine Open-Source-Ermittlungsplattform: Detektoren und Tags heben Beweise über moderne Quellsysteme hinweg hervor, Lineage verbindet sie, aus Befunden werden Anfragen, Duplikate und Fälle, und Harness AI bearbeitet die Ermittlung zwischen den Scans. Verfügbar als kostenloses All-in-one-Docker-Image für macOS, Windows und Linux sowie als Helm-Chart für Kubernetes.",
    offers: [
      {
        "@type": "Offer",
        name: "Classifyre All-in-One (Docker)",
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

  const getHref = `${withLocalePrefix("de", routes.get)}/`;

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
          <HeroBoard locale="de" />
          <div className="relative flex flex-col gap-10 text-white lg:flex-row lg:items-center lg:gap-14">
            <div className="space-y-7 lg:flex-[1.35]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center border-2 border-accent bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                  Open-Source-Ermittlungsplattform
                </span>
                <span className="inline-flex items-center border-2 border-white/25 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                  {/* The published release when it could be resolved — the
                      workspace version can be a -SNAPSHOT ahead of it. */}
                  v{softwareVersion}
                </span>
              </div>

              <h1
                id="hero-title"
                className="font-hero text-[clamp(4.2rem,11vw,9rem)] font-normal uppercase leading-[0.86] tracking-[0.01em] text-white"
              >
                <span className="block">Verstreute Daten rein.</span>
                <span className="block">
                  Geschlossene Fälle {" "}
                  <span className="inline-block bg-accent px-[0.12em] text-black">
                    raus.
                  </span>
                </span>
              </h1>

              <p className="max-w-2xl text-lg leading-8 text-white/78">
                Classifyre liest die Systeme, die Sie bereits betreiben, und
                findet die von Ihnen definierten Signale — und verfolgt sie dann
                über Quellen hinweg, wie ein Detektiv, während ein KI-Autopilot
                die Laufarbeit zwischen den Scans übernimmt.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                >
                  <a href="#run-it">Lokal betreiben</a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                >
                  <a href={showcaseUrlFor("de")} target="_blank" rel="noreferrer">
                    Live-Showcase ausprobieren
                  </a>
                </Button>
              </div>
            </div>

            {/* The investigator's case file: the logo pinned as exhibit A,
                where the convergence threads land. */}
            <div className="lg:flex-1">
              <div className="cl-float relative mx-auto w-60 sm:w-72 lg:w-80">
                <div className="flex">
                  <span className="border-2 border-b-0 border-white/25 bg-white/5 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
                    Fallakte · 042
                  </span>
                </div>
                <div className="relative border-2 border-white/25 bg-white/[0.04] p-5 sm:p-6">
                  <span
                    aria-hidden="true"
                    className="absolute -left-1 -top-1 size-2 bg-accent"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 size-2 bg-accent"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 -left-1 size-2 bg-accent"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 -right-1 size-2 bg-accent"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/clasifyre_icon.png"
                    alt="Der Classifyre-Ermittler — eine Detektiv-Katze auf grüner Plakette"
                    width={288}
                    height={288}
                    className="w-full drop-shadow-[0_0_70px_rgba(183,255,0,0.3)]"
                  />
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/15 pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                    <span className="text-white/60">Der Ermittler</span>
                    <span className="inline-flex items-center gap-1.5 text-accent">
                      <span
                        aria-hidden="true"
                        className="inline-block size-1.5 rounded-full bg-accent"
                      />
                      Im Dienst
                    </span>
                  </div>
                </div>
                <div
                  className="cl-stamp absolute -right-4 -top-3 border-[3px] border-accent px-2.5 py-1 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-accent"
                  style={{ "--cl-delay": "700ms" } as CSSProperties}
                >
                  Fall eröffnet
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
              {/* Docker — the primary path */}
              <div className="flex h-full min-w-0 flex-col gap-6 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)] sm:p-8">
                <div className="space-y-2">
                  <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    <DockerLogo className="size-3.5" />
                    Ein Befehl · kostenlos · keine Anmeldung
                  </span>
                  <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em] sm:text-3xl">
                    Auf Ihrer Maschine betreiben
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Datenbank, UI und Scan-Worker stecken alle im Image.
                    Alles — Quellen, Befunde, Fälle — bleibt auf Ihrer Maschine.
                  </p>
                </div>

                <DockerRunBlock
                  lines={dockerRunLines(dockerImageTag, getDockerNotes("de"))}
                  copy={deTranslations.docker}
                />

                <div className="mt-auto space-y-3">
                  <Button asChild size="lg" className="w-full">
                    <a href={getHref}>Setup &amp; Konfiguration</a>
                  </Button>
                </div>
              </div>

              {/* Kubernetes — the same product, scaled out */}
              <div className="flex h-full min-w-0 flex-col gap-6 border-2 border-foreground bg-foreground p-6 text-primary-foreground shadow-[6px_6px_0_var(--color-accent)] sm:p-8">
                <div className="space-y-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent dark:text-accent-foreground">
                    Helm-Chart · skaliert beliebig
                  </span>
                  <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em] sm:text-3xl">
                    Oder auf Kubernetes betreiben
                  </h3>
                  <p className="text-sm leading-6 text-primary-foreground/72">
                    Derselbe Kern als Helm-Chart, mit ephemeren Scan-Workern,
                    die zwischen den Läufen auf null skalieren und so weit
                    auffächern, wie Ihr Bestand reicht. Ihr Cluster, Ihre Daten.
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

                <div className="mt-auto flex flex-wrap gap-2">
                  <DocsLink href={docs.kubernetes} tone="signal">
                    Helm-Chart-Doku
                  </DocsLink>
                  <DocsLink
                    href={`${repoUrl}/blob/main/helm/classifyre/README.md`}
                    tone="signal"
                  >
                    Chart-README auf GitHub
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
                  Befunde sind Beweise.
                  <br />
                  Fälle sind das Produkt.
                </>
              }
              lede="Die meisten Scanner enden bei einer Befundtabelle und wünschen viel Glück. Classifyre geht weiter — jeder Befund ist ein Beweisstück in einer Ermittlung, mit der jemand wirklich arbeiten kann."
              action={<DocsLink href={docs.howItWorks}>So funktioniert es</DocsLink>}
            />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-stretch">
              <Reveal className="border-2 border-border bg-background p-5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Die Pipeline
                </span>
                <div className="mt-4">
                  <EvidenceBoard locale="de" />
                </div>
              </Reveal>

              <figure className="flex min-w-0 flex-col border-2 border-border bg-background p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Ein Fall, der sich selbst zusammenstellt
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:hidden">
                    Wischen →
                  </span>
                </div>
                {/* The graph is a wide landscape drawing. Squeezed into a phone
                    it scales to ~0.3 and its labels stop being readable, so
                    below `lg` it keeps a legible width and scrolls sideways
                    instead. Bleeds into the figure padding so the scroll edge
                    reads as intentional. */}
                <div className="-mx-5 my-auto overflow-x-auto px-5 py-4 lg:mx-0 lg:overflow-visible lg:px-0">
                  <div className="min-w-142 lg:min-w-0">
                    <CaseGraph locale="de" />
                  </div>
                </div>
                <figcaption className="border-t-2 border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Eine klassifizierte Datei, per Mail nach draußen: Absender
                  zurückverfolgt, Auswirkung eingegrenzt, Duplikat bestätigt —
                  alles zugeordnet.
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
              title="Scannen Sie die Systeme, die Sie bereits besitzen"
              lede="Operative Datenbanken, Lakehouses, Kollaborationstools, Analyse-Assets und öffentliche Inhalte — alle speisen einen einzigen Beweisstrom."
              action={<DocsLink href={`${docs.root}/sources/`}>Quellen-Dokumentation</DocsLink>}
            />

            <SourceMarquee />


          </div>
        </LandingSectionShell>

        <LandingSectionShell tone="plain" className="border-0">
          <SourceCatalogSection locale="de" />
        </LandingSectionShell>
      </section>

      {/*/!* ── Detectors: built-in packs + the custom ladder ────────────────── *!/*/}
      {/*<section aria-labelledby="detectors-title">*/}
      {/*  <LandingSectionShell tone="signal">*/}
      {/*    <div className="space-y-8">*/}
      {/*      <SectionHead*/}
      {/*        id="detectors-title"*/}
      {/*        marker="Detektoren"*/}
      {/*        tone="signal"*/}
      {/*        illustration="probe"*/}
      {/*        title="Einen einschalten. Beweise folgen."*/}
      {/*        lede="Kuratierte Packs für PII, Secrets, Security, Moderation und Qualität greifen beim ersten Scan — ganz ohne Modell-Bastelei."*/}
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
      {/*            Eigene gefällig? Von Regex bis beliebiges Modell*/}
      {/*          </span>*/}
      {/*          <a*/}
      {/*            href={docs.customDetectors}*/}
      {/*            target="_blank"*/}
      {/*            rel="noreferrer"*/}
      {/*            className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground/70 underline-offset-4 hover:text-accent hover:underline dark:hover:text-accent-foreground"*/}
      {/*          >*/}
      {/*            Custom-Detektor-Doku →*/}
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
      {/*              nicht Copilot*/}
      {/*            </span>*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="Niemand muss einen Prompt tippen. Nach jedem Scan wachen fünf Agenten der Reihe nach auf und bringen die Ermittlung voran — jeder loggt, was er getan hat und warum."*/}
      {/*        action={*/}
      {/*          <DocsLink href={docs.autopilot} tone="signal">*/}
      {/*            Autopilot-Doku*/}
      {/*          </DocsLink>*/}
      {/*        }*/}
      {/*      />*/}

      {/*      /!* The ring is the poster; the five drawings below are the cast.*/}
      {/*          Giving each agent its own full-size illustration beats cramming*/}
      {/*          them into a two-column list of thumbnails. *!/*/}
      {/*      <div className="flex flex-col items-center gap-4">*/}
      {/*        <MissionRing />*/}
      {/*        <p className="max-w-md text-center font-mono text-[10px] uppercase leading-5 tracking-[0.14em] text-primary-foreground/55">*/}
      {/*          Observe-only einschalten, und er schlägt vor, ohne etwas anzufassen*/}
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
      {/*        marker="Isolierte Workspaces"*/}
      {/*        title={*/}
      {/*          <>*/}
      {/*            Eine Instanz.*/}
      {/*            <br />*/}
      {/*            Versiegelte Fallakten.*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="Ein Mandant, eine Region, ein Geschäftsbereich — jeder bekommt eigenes PostgreSQL-Schema, eigene Beweise, eigenes KI-Memory und eigenen Endpunkt. Eine Mauer, keine Tenant-Spalte, die jemand zu filtern vergessen könnte."*/}
      {/*        action={*/}
      {/*          <DocsLink href={docs.workspaces}>Workspace-Doku</DocsLink>*/}
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
      {/*                      Kein Übergang*/}
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
      {/*                      Versiegelt*/}
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
      {/*              Nicht geteilt. Nie.*/}
      {/*            </span>*/}
      {/*          </div>*/}
      {/*          <ul className="grid grid-cols-2 gap-x bg-border">*/}
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
      {/*            Eine Partnerschaft,*/}
      {/*            <br />*/}
      {/*            kein Lizenzschlüssel*/}
      {/*          </>*/}
      {/*        }*/}
      {/*        lede="Unsere Engineers arbeiten mit Ihrem Team ab dem ersten Piloten — lernen, wie Ihr Business Dinge benennt, und stimmen Classifyre darauf ab, wie Ihre Firma wirklich arbeitet."*/}
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
      {/*            Gespräch beginnen*/}
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
          <ClosingBoard locale="de" />
          <div className="relative text-white">
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
                Eröffnen Sie Ihren ersten Fall{" "}
                <span className="inline-block bg-accent px-[0.12em] text-black">
                  heute Nacht.
                </span>
              </h2>
              <p className="max-w-xl text-base leading-7 text-white/70">
                Betreiben Sie es, richten Sie es auf ein System, das Sie
                bereits betreiben, und sehen Sie, was der Ermittler findet.
                Alles, was Sie aufbauen, tragen Sie mit, wenn Sie mit Helm
                remote gehen.
              </p>
              <div className="flex w-full flex-col items-center gap-4">
                <div className="w-full max-w-2xl">
                  <DockerRunBlock
                    tone="dark"
                    lines={dockerRunLines(dockerImageTag, getDockerNotes("de"))}
                    copy={deTranslations.docker}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                  >
                    <a href={getHref}>Holen Sie sich Ihr eigenes Classifyre</a>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="secondary"
                    className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                  >
                    <a href={showcaseUrlFor("de")} target="_blank" rel="noreferrer">
                      Live-Showcase ausprobieren
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>
    </main>
  );
}
