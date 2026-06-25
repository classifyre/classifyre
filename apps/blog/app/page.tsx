import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DetectorCatalog,
  detectorCatalogGroups,
  resolveDetectorGroupId,
  SourceCatalog,
  SourceIcon,
} from "@workspace/ui/components";
import {
  resolveSourceCatalogMeta,
  SOURCE_TYPE_CATALOG_META,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import { softwareVersion } from "@workspace/ui/lib/software-version";
import { cn } from "@workspace/ui/lib/utils";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";
import { AssistantDemo } from "@/components/assistant-demo";
import { HarnessSimulation } from "@/components/harness-simulation";

export const metadata: Metadata = {
  title: "The Open-Source Investigation Platform for Your Data",
  description:
    "Classifyre turns raw findings into real investigations. Connect the systems you already run, detect what matters, and let Harness AI — five autonomous agents — open inquiries, build cases, tune sources, and author detectors, with every decision explained.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Classifyre | Detect. Investigate. Resolve.",
    description:
      "An open-source investigation platform: detectors surface evidence, and Harness AI — a five-agent autopilot — opens inquiries, builds cases, drafts hypotheses, and authors detectors with a full audit trail.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre | Detect. Investigate. Resolve.",
    description:
      "Open-source core, Harness AI — autonomous agents that act instead of chat — custom detectors from regex to any model, and a clear path from laptop to enterprise.",
  },
};

const sourceEntries = Object.keys(SOURCE_TYPE_CATALOG_META).map((type) => ({
  type,
  ...resolveSourceCatalogMeta(type),
}));

const marqueeEntries = [...sourceEntries, ...sourceEntries];
const dockerRunCommand = [
  "docker run --rm -p 3000:3000 \\",
  `classifyre/all-in-one:${softwareVersion}`,
];
const helmInstallCommand = [
  "helm install classifyre \\",
  "  oci://registry-1.docker.io/classifyre/classifyre-core \\",
  `  --version ${softwareVersion}`,
];
const enterpriseContactEmail = "contact@classifyre.com";

const enterpriseCapabilities = [
  "Authentication, authorization, and governance — the layer the open-source core intentionally leaves out",
  "Custom models and instance fine-tuning so detection speaks your business language",
  "SLA-backed support with upgrade and deployment assistance across Kubernetes and OpenShift",
  "Custom sources, detectors, and multilanguage support built around your domain",
] as const;

const investigationPillars = [
  {
    marker: "INQUIRIES",
    title: "Standing questions that keep watching",
    description:
      "Phrase what you actually want to know — “Are credentials leaking through CI logs?” — and the inquiry keeps matching new topics and findings against it, scan after scan.",
  },
  {
    marker: "CASES",
    title: "Evidence with an owner and a lifecycle",
    description:
      "Findings get attached to cases instead of dying in a CSV export. Each case carries its evidence, status, and history toward an actual resolution.",
  },
  {
    marker: "HYPOTHESES",
    title: "Competing explanations, pinned to evidence",
    description:
      "Work a case like an analyst: propose explanations, link each one to the findings that support or contradict it, and watch the graph confirm or kill it.",
  },
  {
    marker: "COLLABORATION",
    title: "Humans and AI in one audit trail",
    description:
      "Teammates and the autopilot operate on the same cases, with every action — human or AI — attributed and explained in a shared record.",
  },
] as const;

const harnessMissions = [
  {
    step: "01",
    marker: "Inquiry",
    title: "Keeps standing questions answered",
    description:
      "Matches fresh findings to your inquiries and dedupes the rest — so similar signals collapse into one monitor instead of a flood.",
    tools: ["findings.search", "inquiries.enrich"],
  },
  {
    step: "02",
    marker: "Case",
    title: "Builds the investigation",
    description:
      "Opens and enriches cases: drafts competing hypotheses, attaches evidence, and links findings into the case graph.",
    tools: ["cases.create", "cases.add_hypothesis"],
  },
  {
    step: "03",
    marker: "Config",
    title: "Wakes up silent sources",
    description:
      "Profiles sources that ingest data but produce nothing, then enables the detectors that fit the data shape — no manual setup.",
    tools: ["assets.profile", "config.tune_source"],
  },
  {
    step: "04",
    marker: "Detector Author",
    title: "Writes the detector you were missing",
    description:
      "When findings slip through, it hypothesizes a detector, dry-runs it, ships it, and verifies the results on the next cycle.",
    tools: ["detector.test", "detector.create"],
  },
  {
    step: "05",
    marker: "Dream",
    title: "Consolidates what it learned",
    description:
      "Curates long-lived memory and rewrites the system brief so every agent starts the next cycle grounded in today's reality.",
    tools: ["memory.rewrite", "system_brief.update"],
  },
] as const;

const harnessControls = [
  {
    marker: "IT LEARNS",
    title: "A memory you can read",
    description:
      "Harness builds a memory of your instance — business glossary, decision precedents, topic-to-inquiry maps — composed into a system brief that grounds every agent. Inspect and edit any of it.",
  },
  {
    marker: "IT ACTS",
    title: "No prompt required",
    description:
      "Five agents move the investigation forward on their own after every scan. Want to point them somewhere? Steer Harness with a one-line instruction.",
  },
  {
    marker: "YOU COMMAND",
    title: "Observe-only when you want it",
    description:
      "Flip the whole instance — or a single case — into observe-only and Harness proposes without touching. Every action, human or AI, lands in one audit trail with a written rationale.",
  },
] as const;

const detectorLadder = [
  {
    tier: "01",
    power: 1,
    marker: "RULESET",
    title: "Regex & rules",
    description:
      "Deterministic pattern matching for IDs, secrets formats, policy phrases, and internal codes. Instant, explainable, zero ML overhead.",
    tags: ["deterministic", "fast", "no GPU"],
  },
  {
    tier: "02",
    power: 2,
    marker: "TEXT INTELLIGENCE",
    title: "Entities & classification",
    description:
      "Extract entities and classify text in a single model pass, using labels written in your own words. Contextual understanding without training a model.",
    tags: ["zero-shot", "your labels", "one pass"],
  },
  {
    tier: "03",
    power: 3,
    marker: "TRANSFORMERS",
    title: "Any Hugging Face model",
    description:
      "Plug in open models for text classification, image classification, object detection, and embeddings. Yes — Classifyre sees images, not just text.",
    tags: ["text + vision", "open models", "embeddings"],
  },
  {
    tier: "04",
    power: 4,
    marker: "AI DETECTOR",
    title: "Bring any LLM",
    description:
      "Write a prompt, define labels and extraction fields, and any configured LLM provider becomes a detector — for signals too fuzzy to define any other way.",
    tags: ["any provider", "prompt-defined", "extraction"],
  },
] as const;

function Marker({ label, inverted = false }: { label: string; inverted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]",
        inverted
          ? "border-accent bg-accent text-black"
          : "border-border bg-background text-foreground",
      )}
    >
      {label}
    </span>
  );
}

function LandingSectionShell({
  tone = "plain",
  fullWidth = false,
  children,
  className = "",
}: {
  tone?: "signal" | "plain";
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        fullWidth
          ? "left-1/2 w-screen max-w-none -translate-x-1/2 rounded-none border-0"
          : "rounded-[8px] border-2 border-border",
        tone === "signal"
          ? "bg-foreground text-primary-foreground"
          : "bg-background text-foreground",
        className,
      )}
    >
      {tone === "signal" ? (
        <div className="landing-grid absolute inset-0 opacity-30" />
      ) : null}
      <div
        className={cn(
          "relative py-8 sm:py-10 lg:py-12",
          fullWidth ? "px-4 sm:px-6 lg:px-10" : "px-6 sm:px-8 lg:px-10",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function CommandBlock({
  label,
  lines,
  inverted = false,
}: {
  label: string;
  lines: readonly string[];
  inverted?: boolean;
}) {
  return (
    <div
      className={`border-2 border-border p-4 ${
        inverted
          ? "bg-foreground text-primary-foreground"
          : "bg-background text-foreground"
      }`}
    >
      <div
        className={`mb-3 text-[11px] font-mono uppercase tracking-[0.14em] ${
          inverted ? "text-primary-foreground/55" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <pre className="overflow-hidden whitespace-pre-wrap wrap-break-word font-mono text-xs leading-6 sm:text-sm">
        <code>{lines.join("\n")}</code>
      </pre>
    </div>
  );
}

/**
 * Static illustration of a Classifyre case graph: one case, two competing
 * hypotheses, severity-colored findings, a manual analyst link, and a
 * cross-hypothesis link. Strokes use currentColor so it adapts to theme.
 */
function CaseGraphIllustration() {
  const severity = {
    critical: "#ff2b2b",
    high: "#ff6b35",
    medium: "#f5a623",
    low: "#0ea5e9",
  } as const;

  return (
    <svg
      viewBox="0 0 720 460"
      role="img"
      aria-label="Case graph showing a case linked to two hypotheses with severity-colored findings"
      className="h-auto w-full"
    >
      <defs>
        <pattern id="cg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" opacity="0.12" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="720" height="460" fill="url(#cg-dots)" />

      {/* edges: case -> hypotheses */}
      <line x1="360" y1="92" x2="190" y2="196" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <line x1="360" y1="92" x2="530" y2="196" stroke="currentColor" strokeWidth="2" opacity="0.45" />

      {/* edges: hypotheses -> findings */}
      <line x1="190" y1="252" x2="110" y2="340" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <line x1="190" y1="252" x2="210" y2="350" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <line x1="530" y1="252" x2="470" y2="350" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <line x1="530" y1="252" x2="590" y2="340" stroke="currentColor" strokeWidth="2" opacity="0.45" />

      {/* manual analyst link (dashed amber) */}
      <line
        x1="210"
        y1="350"
        x2="470"
        y2="350"
        stroke="#d97706"
        strokeWidth="2.5"
        strokeDasharray="7 6"
      />
      <text x="340" y="338" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#d97706" letterSpacing="0.12em">
        ANALYST LINK
      </text>

      {/* cross-hypothesis link (purple) */}
      <path
        d="M 110 340 C 180 440, 520 440, 590 340"
        fill="none"
        stroke="#a855f7"
        strokeWidth="2.5"
        strokeDasharray="3 5"
      />
      <text x="360" y="432" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#a855f7" letterSpacing="0.12em">
        CROSS-HYPOTHESIS
      </text>

      {/* case node */}
      <g>
        <rect x="252" y="34" width="216" height="58" fill="var(--color-accent)" stroke="currentColor" strokeWidth="3" />
        <rect x="260" y="42" width="216" height="58" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" />
        <text x="360" y="58" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#0a0a0a" letterSpacing="0.2em" fontWeight="700">
          CASE #42 · OPEN
        </text>
        <text x="360" y="78" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="12" fill="#0a0a0a" fontWeight="700">
          Credential exposure
        </text>
      </g>

      {/* hypothesis 1 */}
      <g>
        <rect x="92" y="196" width="196" height="56" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <text x="190" y="219" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="currentColor" opacity="0.6" letterSpacing="0.18em">
          HYPOTHESIS 1
        </text>
        <text x="190" y="238" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="12" fill="currentColor" fontWeight="700">
          Leak via CI logs
        </text>
      </g>

      {/* hypothesis 2 */}
      <g>
        <rect x="432" y="196" width="196" height="56" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <text x="530" y="219" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="currentColor" opacity="0.6" letterSpacing="0.18em">
          HYPOTHESIS 2
        </text>
        <text x="530" y="238" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="12" fill="currentColor" fontWeight="700">
          Stale S3 export
        </text>
      </g>

      {/* findings */}
      <g>
        <circle cx="110" cy="340" r="20" fill={severity.critical} stroke="currentColor" strokeWidth="2.5" />
        <text x="110" y="344" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#ffffff" fontWeight="700">
          SEC
        </text>
        <circle cx="210" cy="350" r="20" fill={severity.high} stroke="currentColor" strokeWidth="2.5" />
        <text x="210" y="354" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#0a0a0a" fontWeight="700">
          PII
        </text>
        <circle cx="470" cy="350" r="20" fill={severity.medium} stroke="currentColor" strokeWidth="2.5" />
        <text x="470" y="354" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#0a0a0a" fontWeight="700">
          IBN
        </text>
        <circle cx="590" cy="340" r="20" fill={severity.low} stroke="currentColor" strokeWidth="2.5" />
        <text x="590" y="344" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#0a0a0a" fontWeight="700">
          SEC
        </text>
      </g>

      {/* autopilot tag near hypothesis 2 */}
      <g>
        <rect x="560" y="160" width="118" height="24" fill="var(--color-accent)" stroke="currentColor" strokeWidth="2" />
        <text x="619" y="176" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="9" fill="#0a0a0a" letterSpacing="0.14em" fontWeight="700">
          BY AUTOPILOT
        </text>
        <line x1="600" y1="184" x2="556" y2="196" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      </g>
    </svg>
  );
}

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

export default function HomePage() {
  const sourceDocs = getAllSourceDocs();
  const detectorDocs = getAllDetectorDocs();
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
  );
  const searchableSourceEntries: SourceCatalogEntry[] = sourceDocs
    .map((source) => ({
      type: source.sourceType,
      href: `https://docs.classifyre.com/sources/${source.slug}/`,
      ...resolveSourceCatalogMeta(source.sourceType, {
        label: source.label,
      }),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
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
      href: `https://docs.classifyre.com/detectors/${detector.slug}/`,
    }));

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Classifyre",
    applicationCategory: "SecurityApplication",
    operatingSystem: "Docker, Kubernetes, Web",
    url: siteUrl,
    description:
      "Classifyre is an open-source investigation platform: detectors surface evidence across modern source systems, and Harness AI — a five-agent autopilot (inquiry, case, config, detector-author, and memory) — opens inquiries, builds cases, tunes sources, and authors detectors with a full audit trail.",
    offers: [
      {
        "@type": "Offer",
        name: "Run Locally (Docker)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Open Source Core on Kubernetes",
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
      <section>
        <LandingSectionShell tone="signal" fullWidth className="bg-black">
          <div className="space-y-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12">
              <div className="space-y-5 lg:flex-1">
                <h1 className="font-serif text-[clamp(3.2rem,8vw,5.8rem)] font-black uppercase leading-[0.84] tracking-[0.08em] text-white">
                  <span className="block text-white">Detect.</span>
                  <span className="block">
                    <span className="inline-block bg-accent px-[0.14em] text-black">
                      Investigate.
                    </span>
                  </span>
                  <span className="block text-white">Resolve.</span>
                </h1>
              </div>

              <div className="space-y-6 lg:flex-1">
                <p className="max-w-2xl text-left text-base leading-7 text-white/78 sm:text-lg lg:text-left">
                  Classifyre is an open-source investigation platform for your
                  data estate. Connect the systems you already run, let
                  detectors surface the evidence — then work it like an
                  analyst, with standing inquiries, cases, hypotheses, and an
                  AI autopilot that does the legwork between scans.
                </p>

                <div className="flex flex-wrap gap-3 lg:justify-start">
                  <Button
                    asChild
                    className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                  >
                    <a
                      href="https://demo.classifyre.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Try Demo
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                  >
                    <a
                      href="https://docs.classifyre.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get Started
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border border-white/20 bg-white/8 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/54">
                  Source Types
                </p>
                <p className="mt-2 text-3xl font-black text-accent">
                  {sourceEntries.length}+
                </p>
                <p className="mt-1 text-sm text-white/68">
                  Databases, lakehouses, collaboration tools, BI, and web
                  content.
                </p>
              </div>
              <div className="border border-white/20 bg-white/8 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/54">
                  Detector Families
                </p>
                <p className="mt-2 text-3xl font-black text-accent">
                  {activeDetectorItems.length}
                </p>
                <p className="mt-1 text-sm text-white/68">
                  Built-in packs for PII, secrets, and security — plus four
                  custom engines from regex to any LLM.
                </p>
              </div>
              <div className="border border-white/20 bg-white/8 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/54">
                  AI Decisions Explained
                </p>
                <p className="mt-2 text-3xl font-black text-accent">100%</p>
                <p className="mt-1 text-sm text-white/68">
                  Every autopilot action lands in the audit trail with a
                  written rationale.
                </p>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Investigation layer ──────────────────────────────────────────── */}
      <section aria-labelledby="investigation-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-8">
            <div className="space-y-3">
              <Marker label="The investigation layer" inverted />
              <h2
                id="investigation-title"
                className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
              >
                Findings are evidence.
                <br />
                Cases are the product.
              </h2>
              <p className="max-w-3xl text-muted-foreground">
                Most scanners stop at a findings table and wish you luck.
                Classifyre treats every finding as evidence in an ongoing
                investigation — connected to the questions you are asking, the
                cases you are working, and the explanations you are testing.
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {investigationPillars.map((pillar) => (
                  <div
                    key={pillar.marker}
                    className="flex flex-col gap-2 border-2 border-border bg-background p-4 shadow-[4px_4px_0_var(--color-border)]"
                  >
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent-foreground/60 dark:text-accent">
                      {pillar.marker}
                    </span>
                    <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                      {pillar.title}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {pillar.description}
                    </p>
                  </div>
                ))}
              </div>

              <figure className="border-2 border-border bg-background p-4 shadow-[6px_6px_0_var(--color-border)]">
                <CaseGraphIllustration />
                <figcaption className="mt-2 border-t-2 border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  A live case graph: hypotheses linked to severity-rated
                  evidence, analyst links, and autopilot contributions.
                </figcaption>
              </figure>
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Harness AI ───────────────────────────────────────────────────── */}
      <section aria-labelledby="harness-title">
        <LandingSectionShell tone="signal">
          <div className="space-y-10">
            <div className="space-y-3">
              <Marker label="Harness AI" inverted />
              <h2
                id="harness-title"
                className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
              >
                Meet Harness AI — autopilot,{" "}
                <span className="inline-block bg-accent px-[0.14em] text-black">
                  not copilot
                </span>
              </h2>
              <p className="max-w-3xl text-primary-foreground/72">
                A copilot waits for you to type a prompt. Harness AI doesn&apos;t
                wait. It&apos;s a team of five specialized agents that wake after
                every scan, recall what they&apos;ve learned about your instance,
                and move the investigation forward on their own — deduping
                findings, building cases, tuning sources, even authoring the
                detectors you were missing. Every move is explained.
              </p>
            </div>

            {/* Five missions */}
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary-foreground/55">
                Five missions, one loop
              </p>
              <ol className="grid gap-3 md:grid-cols-5">
                {harnessMissions.map((mission) => (
                  <li
                    key={mission.step}
                    className="flex flex-col border border-primary-foreground/25 bg-primary-foreground/5 p-4"
                  >
                    <span className="font-mono text-2xl font-black text-accent">
                      {mission.step}
                    </span>
                    <span className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                      {mission.marker}
                    </span>
                    <p className="mt-1 text-sm font-bold uppercase leading-snug tracking-[0.04em]">
                      {mission.title}
                    </p>
                    <p className="mt-1.5 text-xs leading-5 text-primary-foreground/65">
                      {mission.description}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1 pt-3">
                      {mission.tools.map((tool) => (
                        <span
                          key={tool}
                          className="border border-primary-foreground/20 bg-primary-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-primary-foreground/70"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* How it works + flight recorder */}
            <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
              <div className="flex flex-col gap-4">
                <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em] sm:text-3xl">
                  A flight recorder, not a black box
                </h3>
                <p className="text-base leading-7 text-primary-foreground/72">
                  Each agent runs a resumable reason → act loop: it reads the
                  live system brief, calls real tools, and writes back what it
                  did and why. Watch one cycle play out — every decision is
                  audited, and every deliberate non-action is recorded too.
                </p>
                <ul className="space-y-2 text-sm leading-6 text-primary-foreground/72">
                  <li className="border-l-2 border-accent pl-3">
                    <span className="font-bold text-primary-foreground">
                      Grounded in facts.
                    </span>{" "}
                    A server-composed system brief — live counts plus learned
                    memory — keeps every agent on the same page.
                  </li>
                  <li className="border-l-2 border-accent pl-3">
                    <span className="font-bold text-primary-foreground">
                      Idempotent &amp; resumable.
                    </span>{" "}
                    Runs persist mid-loop and resume without replaying work, so
                    side effects never double-fire.
                  </li>
                  <li className="border-l-2 border-accent pl-3">
                    <span className="font-bold text-primary-foreground">
                      You stay in command.
                    </span>{" "}
                    Steer it with a one-line instruction, or flip observe-only
                    and it proposes without touching a thing.
                  </li>
                </ul>
              </div>

              <HarnessSimulation />
            </div>

            {/* Controls */}
            <div className="grid gap-3 md:grid-cols-3">
              {harnessControls.map((control) => (
                <div
                  key={control.marker}
                  className="border-2 border-primary-foreground/30 bg-primary-foreground/8 p-5"
                >
                  <span className="inline-flex bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                    {control.marker}
                  </span>
                  <p className="mt-3 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                    {control.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-primary-foreground/72">
                    {control.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Assistant (setup) ────────────────────────────────────────────── */}
      <section aria-labelledby="assistant-demo-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-6">
            <AssistantDemo />
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="sources-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div>
                  <h2
                    id="sources-title"
                    className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
                  >
                    Scan the systems you already own
                  </h2>
                  <p className="mt-3 max-w-3xl text-muted-foreground">
                    Classifyre is built for mixed estates: operational
                    databases, lakehouse and warehouse platforms, collaboration
                    systems, analytics assets, and public-facing content — all
                    feeding evidence into the same investigation layer.
                  </p>
                </div>
              </div>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a
                  href="https://docs.classifyre.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Connector docs
                </a>
              </Button>
            </div>

            <div className="edge-fade-x overflow-hidden py-3">
              <div className="marquee-track-slow flex w-max items-stretch gap-14 py-6">
                {marqueeEntries.map((entry, index) => (
                  <div
                    key={`${entry.type}-${index}`}
                    className="flex min-w-40 flex-col items-center justify-center gap-4 px-5 text-center"
                  >
                    <SourceIcon
                      source={String(entry.icon)}
                      size="lg"
                      className="[&_svg]:h-14 [&_svg]:w-14 [&_svg]:text-foreground"
                    />
                    <span className="max-w-32 text-base font-medium uppercase tracking-[0.08em]">
                      {entry.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <SourceCatalog entries={searchableSourceEntries} />
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Built-in detectors ───────────────────────────────────────────── */}
      <section aria-labelledby="detectors-title">
        <LandingSectionShell tone="signal">
          <div className="space-y-6">
            <div className="space-y-3">
              <div>
                <h2
                  id="detectors-title"
                  className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
                >
                  Evidence on day one
                </h2>
                <p className="mt-3 max-w-3xl text-primary-foreground/72">
                  Switch on curated built-in packs — PII, secrets, security,
                  moderation, quality — and findings start flowing into your
                  investigations immediately. No model wrangling required.
                </p>
              </div>
            </div>

            <DetectorCatalog
              items={activeDetectorItems}
              groups={detectorCatalogGroups}
              external
            />
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Custom detector ladder ───────────────────────────────────────── */}
      <section aria-labelledby="detector-ladder-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <Marker label="Custom detectors" inverted />
                <h2
                  id="detector-ladder-title"
                  className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
                >
                  From a regex to any model
                </h2>
                <p className="max-w-3xl text-muted-foreground">
                  Custom detection is a ladder, not a leap. Start with a
                  deterministic rule, climb to zero-shot text understanding,
                  plug in open transformer models for text and images, and top
                  out with an LLM detector for the signals nothing else can
                  catch. Every rung feeds the same findings stream.
                </p>
              </div>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a
                  href="https://docs.classifyre.com/custom-detectors/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Custom detector docs
                </a>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {detectorLadder.map((rung, index) => (
                <div
                  key={rung.tier}
                  className={cn(
                    "group flex flex-col border-2 border-border bg-background p-5 shadow-[4px_4px_0_var(--color-border)] transition-all hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-border)]",
                    index === detectorLadder.length - 1 &&
                      "border-accent shadow-[4px_4px_0_var(--color-accent)] hover:shadow-[6px_6px_0_var(--color-accent)]",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className="font-mono text-3xl font-black text-foreground/15">
                      {rung.tier}
                    </span>
                    <PowerMeter level={rung.power} />
                  </div>
                  <span className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    {rung.marker}
                  </span>
                  <p className="mt-1 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                    {rung.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {rung.description}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-4">
                    {rung.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-border/40 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Deployment path ──────────────────────────────────────────────── */}
      <section aria-labelledby="runtime-title">
        <LandingSectionShell tone="plain" fullWidth>
          <div className="grid grid-cols-1 gap-6 pb-10 lg:grid-cols-2 lg:items-start">
            <h2
              id="runtime-title"
              className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-wider sm:text-5xl"
            >
              Run it tonight. Scale it later.
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Spin up the whole platform on your own machine and start your
              first investigation. Move to Kubernetes when the team joins in.
              Add the enterprise layer when governance, custom models, and
              guaranteed support become requirements.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card className="panel-card h-full rounded-[16px] border-2 bg-card">
              <CardHeader className="gap-4">
                <div className="space-y-2">
                  <CardTitle className="text-2xl uppercase tracking-[0.04em]">
                    01 Run it locally
                  </CardTitle>
                  <CardDescription className="text-sm leading-6 text-muted-foreground">
                    One Docker command brings up the full platform on your
                    laptop. Connect a source, switch on detectors, and start
                    investigating — no signup, no cluster, no sales call.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <CommandBlock
                  label="One command"
                  lines={dockerRunCommand}
                  inverted
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  The complete product, single-container topology. Everything
                  you build here carries over to production.
                </p>
                <div className="mt-auto pt-2">
                  <Button
                    asChild
                    variant="secondary"
                    className="w-full border-2 border-border"
                  >
                    <a
                      href="https://docs.classifyre.com/deployment/docker/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      All-in-One Docker docs
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="panel-card h-full rounded-[16px] border-2 bg-foreground text-primary-foreground">
              <CardHeader className="gap-4">
                <div className="space-y-2">
                  <CardTitle className="text-2xl uppercase tracking-[0.04em] text-primary-foreground">
                    02 Go production
                  </CardTitle>
                  <CardDescription className="text-sm leading-6 text-primary-foreground/72">
                    Deploy the open-source core to Kubernetes with Helm —
                    self-hosted or in your cloud — with properly separated
                    components and ephemeral processing workers.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <CommandBlock label="Helm install" lines={helmInstallCommand} />
                <p className="text-sm leading-6 text-primary-foreground/72">
                  Production-ready core for real clusters. Enterprise
                  authentication, governance, and SLA coverage live one step
                  up.
                </p>
                <div className="mt-auto pt-2">
                  <Button
                    asChild
                    variant="secondary"
                    className="w-full border-2 border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/16"
                  >
                    <a
                      href="https://docs.classifyre.com/deployment/kubernetes/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Helm chart docs
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="panel-card h-full rounded-[16px] border-2 border-accent bg-background">
              <CardHeader className="gap-4">
                <div className="space-y-2">
                  <CardTitle className="text-2xl uppercase tracking-[0.04em]">
                    03 Add enterprise
                  </CardTitle>
                  <CardDescription className="text-sm leading-6 text-muted-foreground">
                    Everything the open-source core deliberately doesn&apos;t
                    ship — for regulated, global, and heavily customized
                    rollouts.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div>
                  <div className="space-y-3">
                    {enterpriseCapabilities.map((capability) => (
                      <label
                        key={capability}
                        className="flex items-start gap-3 text-sm leading-6 text-foreground"
                      >
                        <Checkbox
                          checked
                          tabIndex={-1}
                          aria-readonly="true"
                          className="pointer-events-none mt-1"
                        />
                        <span>{capability}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mt-auto pt-2">
                  <Button
                    asChild
                    className="w-full border-2 border-accent bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <a href={`mailto:${enterpriseContactEmail}`}>Contact Us</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </LandingSectionShell>
      </section>
    </main>
  );
}
