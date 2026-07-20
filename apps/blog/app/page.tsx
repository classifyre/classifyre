import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import {
  Button,
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
import { CaseGraph } from "@/components/case-graph";
import { HarnessSimulation } from "@/components/harness-simulation";
import { MissionRing } from "@/components/mission-ring";
import { PipelineStory } from "@/components/pipeline-story";
import { Reveal } from "@/components/reveal";

import "./landing.css";

export const metadata: Metadata = {
  title: "The Open-Source Investigation Platform for Your Data",
  description:
    "Classifyre turns raw findings into real investigations. Run the full product as a desktop app or deploy it with Helm at any scale, connect the systems you already run, and let semantic ranking float the evidence that matters while Harness AI opens inquiries, builds cases, tunes sources, and authors detectors with every decision explained.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Classifyre | Every leak leaves a trail",
    description:
      "An open-source investigation platform: detectors surface evidence, semantic ranking sorts signal from boilerplate, and Harness AI opens inquiries, builds cases, drafts hypotheses, and authors detectors with a full audit trail. Available for desktop and Kubernetes with Helm.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre | Every leak leaves a trail",
    description:
      "Open-source core, importance-ranked evidence with written reasons, Harness AI, custom detectors from regex to any model, and one product that runs on desktop or Kubernetes.",
  },
};

const sourceEntries = Object.keys(SOURCE_TYPE_CATALOG_META).map((type) => ({
  type,
  ...resolveSourceCatalogMeta(type),
}));

const marqueeEntries = [...sourceEntries, ...sourceEntries];
const desktopDownloadUrl =
  "https://github.com/classifyre/classifyre/releases/latest";
const helmInstallCommand = [
  "helm install classifyre \\",
  "  oci://registry-1.docker.io/classifyre/classifyre-core \\",
  `  --version ${softwareVersion}`,
];
const helmDocsUrl = "https://docs.classifyre.com/deployment/kubernetes/";
const enterpriseContactEmail = "contact@classifyre.com";

const desktopDownloads = [
  { os: "macOS", detail: "Apple Silicon" },
  { os: "Windows", detail: "x64 installer" },
  { os: "Linux", detail: "deb · rpm — x64 & arm64" },
] as const;

const enterprisePillars = [
  {
    marker: "GOVERNANCE",
    title: "The org chart, wired in",
    description:
      "Authentication, authorization, roles, and governance — the layer the open-source core deliberately leaves out, built for regulated rollouts.",
  },
  {
    marker: "CUSTOM MODELS",
    title: "Detection that speaks your language",
    description:
      "Models tuned on your terminology and document shapes, so “account number” means what it means at your company — not on the internet.",
  },
  {
    marker: "CUSTOM DETECTORS",
    title: "Built for your domain",
    description:
      "Detectors, sources, and multilanguage support engineered around the data your industry actually produces — with our engineers doing the building.",
  },
  {
    marker: "GUIDED ROLLOUT",
    title: "We stay in the room",
    description:
      "From first pilot to global deployment: architecture reviews, upgrade assistance across Kubernetes and OpenShift, and SLA-backed support.",
  },
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
      "Findings get attached to cases instead of dying in a CSV export. Each case carries its evidence, status, and history — and proposes its own next leads, ranked by importance.",
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

const semanticsPillars = [
  {
    marker: "IMPORTANCE 0–1",
    title: "Ranked, not piled",
    description:
      "Every finding gets an importance score, and the docket sorts by it out of the box. Severity is one input weighted at ten percent — not the verdict.",
  },
  {
    marker: "WRITTEN REASONS",
    title: "A score you can argue with",
    description:
      "Each rank carries readable reasons — “recurs across systems”, “known test value”, “near-duplicate of 38”. No black-box number decides your morning.",
  },
  {
    marker: "RECURRENCE IS A LEAD",
    title: "Twice is a trail. Fifty times is wallpaper.",
    description:
      "The same value surfacing in a handful of systems, in different contexts, gets promoted as a lead. The same value in fifty assets is boilerplate — it sinks.",
  },
  {
    marker: "SELF-CALIBRATING",
    title: "It re-ranks itself",
    description:
      "Early findings score against an almost-empty space, so once the embedding queue drains, Classifyre recalibrates the whole corpus. Ranks stay honest as evidence grows.",
  },
] as const;

const semanticsFacts = [
  {
    marker: "ONE SEMANTIC SPACE",
    title: "Meaning, indexed",
    description:
      "Every finding is embedded into a pgvector semantic space — a local model out of the box, or any OpenAI-compatible provider you configure. Similar findings and boilerplate clusters come for free.",
  },
  {
    marker: "HYBRID SEARCH",
    title: "Ask in your own words",
    description:
      "Search fuses semantic and keyword results into one ranked list. Ask for “bank details” and the IBANs surface — even when no keyword matches.",
  },
  {
    marker: "RANKED LEADS",
    title: "Cases find their own next evidence",
    description:
      "Each case proposes leads: semantic neighbours of the evidence already attached, plus high-importance matches from its linked inquiries — ranked, capped, reviewable.",
  },
] as const;

/** Illustrative docket rows for the ranked-evidence section. */
const rankedDocket = [
  {
    id: "F-2041",
    label: "AWS access key · CI deploy log",
    score: 0.94,
    reasons: [
      { dir: "up", text: "recurs in 2 systems" },
      { dir: "up", text: "novel" },
      { dir: "up", text: "semantic outlier" },
    ],
  },
  {
    id: "F-1987",
    label: "IBAN · quarterly finance export",
    score: 0.81,
    reasons: [
      { dir: "up", text: "high quality" },
      { dir: "up", text: "distinct context" },
    ],
  },
  {
    id: "F-2033",
    label: "Email address · support inbox dump",
    score: 0.42,
    reasons: [{ dir: "down", text: "38 near-duplicates" }],
  },
  {
    id: "F-2012",
    label: "Card number · 4111 1111 1111 1111",
    score: 0.18,
    reasons: [{ dir: "down", text: "known test value" }],
  },
  {
    id: "F-2029",
    label: "Phone number · page-footer boilerplate",
    score: 0.07,
    reasons: [
      { dir: "down", text: "found in 48 assets" },
      { dir: "down", text: "low extraction quality" },
    ],
  },
] as const;

const harnessMissions = [
  {
    step: "01",
    marker: "Inquiry",
    title: "Keeps standing questions answered",
    description:
      "Matches fresh findings to your inquiries and dedupes the rest — similar signals collapse into one monitor instead of a flood.",
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
      "Curates long-lived memory and refreshes the system brief so every agent starts the next cycle grounded in today's reality.",
    tools: ["memory.rewrite", "system_brief.update"],
  },
] as const;

const harnessFacts = [
  {
    marker: "IT REMEMBERS",
    title: "A memory you can read",
    description:
      "Harness keeps a long-lived memory of your instance — business glossary, decision precedents, topic-to-inquiry maps. Every cycle, the server composes it into a system brief: live counts and learned facts in fixed sections, with only the short overview written by the model. Inspect and edit any of it.",
  },
  {
    marker: "IT STARTS FROM ZERO",
    title: "No findings? It makes some",
    description:
      "Connect a source with no detectors and there is nothing to react to — so Harness profiles the ingested assets instead: column names, mime types, field shapes. From that metadata alone it hypothesizes a detector, dry-runs it against samples, ships it, and checks the results on the next cycle.",
  },
  {
    marker: "IT ANSWERS FOR ITSELF",
    title: "Observe-only when you want it",
    description:
      "Every action — and every deliberate non-action — lands in one audit trail with a written rationale, attributed to the agent that made it. Flip the whole instance, or a single case, into observe-only and Harness proposes without touching a thing.",
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

function Marker({
  label,
  inverted = false,
}: {
  label: string;
  inverted?: boolean;
}) {
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
        "relative",
        // overflow-hidden creates a scroll container and would break
        // position:sticky descendants, so plain sections skip it.
        tone === "signal" && "overflow-hidden",
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

/** Evidence tag: a tilted manila-tag stat with a punched hole. */
function EvidenceTag({
  label,
  value,
  detail,
  tilt,
  delayMs,
}: {
  label: string;
  value: string;
  detail: string;
  tilt: "l" | "r";
  delayMs: number;
}) {
  return (
    <Reveal delayMs={delayMs}>
      <div
        className={cn(
          "relative border-2 border-white/25 bg-white/8 p-4 pt-5",
          tilt === "l" ? "cl-tag-tilt-l" : "cl-tag-tilt-r",
        )}
      >
        <span
          aria-hidden="true"
          className="absolute -top-1.5 left-5 h-3 w-3 rounded-full border-2 border-white/45 bg-black"
        />
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/54">
          {label}
        </p>
        <p className="font-hero mt-1 text-5xl uppercase leading-none text-accent">
          {value}
        </p>
        <p className="mt-2 text-sm leading-6 text-white/68">{detail}</p>
      </div>
    </Reveal>
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
    operatingSystem: "macOS, Windows, Linux, Kubernetes",
    url: siteUrl,
    description:
      "Classifyre is an open-source investigation platform: detectors surface evidence across modern source systems, and Harness AI — a five-agent autopilot (inquiry, case, config, detector-author, and memory) — opens inquiries, builds cases, tunes sources, and authors detectors with a full audit trail. Available as a desktop app for macOS, Windows, and Linux, and as a Helm chart for Kubernetes.",
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
          <div className="space-y-10 text-white">
            <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-14">
              <div className="space-y-6 lg:flex-[1.35]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center border-2 border-accent bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                    Open source
                  </span>
                  <span className="inline-flex items-center border-2 border-white/25 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                    Case file Nº 001
                  </span>
                  <span className="inline-flex items-center border-2 border-white/25 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                    v{softwareVersion}
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

                <p className="max-w-2xl text-base leading-7 text-white/78 sm:text-lg">
                  Classifyre is an open-source investigation platform for your
                  data estate. It scans the systems you already run, detects
                  secrets, PII, and the signals you define — then works them
                  like a detective: standing inquiries, fingerprints,
                  importance-ranked evidence, cases, competing hypotheses, and
                  an AI autopilot that does the legwork between scans.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    asChild
                    className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                  >
                    <a
                      href={desktopDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download the app
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                  >
                    <a
                      href="https://demo.classifyre.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
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
                  <div className="absolute -bottom-8 left-1/2 w-48 -translate-x-1/2">
                    <div className="cl-tag-tilt-r relative border-2 border-white/30 bg-black px-3 py-2 text-center">
                      <span
                        aria-hidden="true"
                        className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white/45 bg-black"
                      />
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                        Lead investigator
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/55">
                        On duty since your last scan
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Runtime rail: desktop or Kubernetes */}
            <div className="border-2 border-white/25 bg-white/4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-white/25 px-4 py-3 sm:px-5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                  Two ways to run it
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
                  Every one is the full product — only the jurisdiction changes
                </span>
              </div>
              <div className="grid divide-y-2 divide-white/25 lg:grid-cols-2 lg:divide-x-2 lg:divide-y-0">
                {/* Desktop */}
                <div className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-white">
                      Desktop
                    </span>
                    <span className="border border-white/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/60">
                      Local · one install
                    </span>
                  </div>
                  <div className="grid gap-1.5">
                    {desktopDownloads.map((download) => (
                      <a
                        key={download.os}
                        href={desktopDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-baseline justify-between gap-2 border border-white/20 bg-white/6 px-2.5 py-1.5 transition-colors hover:border-accent hover:bg-accent/10"
                      >
                        <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-white">
                          {download.os}
                          <span className="text-accent"> ↓</span>
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/50 group-hover:text-white/75">
                          {download.detail}
                        </span>
                      </a>
                    ))}
                  </div>
                  <p className="mt-auto font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">
                    Everything stays on your machine
                  </p>
                </div>

                {/* Helm */}
                <div className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-white">
                      Helm on Kubernetes
                    </span>
                    <span className="border border-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-accent">
                      Remote · any size
                    </span>
                  </div>
                  <pre className="overflow-hidden whitespace-pre-wrap wrap-break-word border border-white/20 bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-5 text-white/85">
                    <code>{helmInstallCommand.join("\n")}</code>
                  </pre>
                  <a
                    href={helmDocsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-auto font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent hover:underline"
                  >
                    Helm chart docs →
                  </a>
                </div>
              </div>
            </div>

            <div className="grid gap-4 pt-4 sm:grid-cols-3">
              <EvidenceTag
                label="Source types"
                value={`${sourceEntries.length}+`}
                detail="Databases, lakehouses, collaboration tools, BI, and web content — one evidence stream."
                tilt="l"
                delayMs={0}
              />
              <EvidenceTag
                label="Built-in detectors"
                value={`${activeDetectorItems.length}`}
                detail="Switch-on packs for PII, secrets, and security — plus four custom engines, regex to any LLM."
                tilt="r"
                delayMs={120}
              />
              <EvidenceTag
                label="Autopilot agents"
                value="5"
                detail="Inquiry, case, config, detector author, dream — every move logged with a written rationale."
                tilt="l"
                delayMs={240}
              />
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── How it all connects: scroll narrative ────────────────────────── */}
      <section aria-labelledby="pipeline-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-8">
            <div className="space-y-3">
              <Marker label="How it all connects" inverted />
              <h2
                id="pipeline-title"
                className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
              >
                Follow the evidence
              </h2>
              <p className="max-w-3xl text-muted-foreground">
                One pipeline runs from the systems you connect to a resolved
                investigation: sources become assets, detectors raise findings,
                findings feed inquiries and fingerprints, and everything
                converges into cases. Here is one real night in the life of it —
                a credential leaking through CI logs, traced end to end.
              </p>
            </div>

            <PipelineStory />
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
                {investigationPillars.map((pillar, index) => (
                  <Reveal key={pillar.marker} delayMs={index * 90}>
                    <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-4 shadow-[4px_4px_0_var(--color-border)]">
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
                  </Reveal>
                ))}
              </div>

              <figure className="border-2 border-border bg-background p-4 shadow-[6px_6px_0_var(--color-border)]">
                <CaseGraph />
                <figcaption className="mt-2 border-t-2 border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Case #42 from the story above, assembling itself: hypotheses
                  linked to severity-rated evidence, an analyst link, a
                  fingerprint match, and autopilot contributions.
                </figcaption>
              </figure>
            </div>
          </div>
        </LandingSectionShell>
      </section>

      {/* ── Semantics: ranked evidence ───────────────────────────────────── */}
      <section aria-labelledby="semantics-title">
        <LandingSectionShell tone="plain">
          <div className="space-y-8">
            <div className="space-y-3">
              <Marker label="The semantic layer" inverted />
              <h2
                id="semantics-title"
                className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl"
              >
                Signal rises.
                <br />
                Noise sinks.
              </h2>
              <p className="max-w-3xl text-muted-foreground">
                Severity tells you what a finding is. Importance tells you
                whether it deserves your morning. Classifyre embeds every
                finding into a semantic space and ranks it from 0 to 1 —
                weighing quality, novelty, context, and how the same value
                recurs across your estate — so the docket opens on the leak, not
                on page forty of boilerplate.
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {semanticsPillars.map((pillar, index) => (
                  <Reveal key={pillar.marker} delayMs={index * 90}>
                    <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-4 shadow-[4px_4px_0_var(--color-border)]">
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
                  </Reveal>
                ))}
              </div>

              {/* The morning docket */}
              <figure className="border-2 border-border bg-background p-4 shadow-[6px_6px_0_var(--color-border)]">
                <div className="mb-3 flex items-center justify-between border-b-2 border-border pb-3">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    The morning docket
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent-foreground/60 dark:text-accent">
                    Sorted by importance
                  </span>
                </div>
                <ol className="flex flex-col gap-2.5">
                  {rankedDocket.map((row, index) => (
                    <Reveal key={row.id} as="li" delayMs={index * 130}>
                      <div className="border border-border/60 bg-background p-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-muted-foreground">
                            {row.id}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {row.label}
                          </span>
                          <span className="font-mono text-xs font-black tabular-nums">
                            {row.score.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 h-2 border border-border bg-foreground/5">
                          <div
                            className={cn(
                              "cl-docket-fill h-full",
                              row.score >= 0.6
                                ? "bg-accent"
                                : "bg-foreground/25",
                            )}
                            style={{ width: `${Math.round(row.score * 100)}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.reasons.map((reason) => (
                            <span
                              key={reason.text}
                              className={cn(
                                "border px-1.5 py-0.5 font-mono text-[10px]",
                                reason.dir === "up"
                                  ? "border-accent-foreground/30 text-accent-foreground/80 dark:border-accent/50 dark:text-accent"
                                  : "border-border/60 text-muted-foreground",
                              )}
                            >
                              {reason.dir === "up" ? "↑" : "↓"} {reason.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </ol>
                <figcaption className="mt-3 border-t-2 border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Every rank ships with its reasons — inspect them, argue with
                  them, or re-sort by severity or recency any time.
                </figcaption>
              </figure>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {semanticsFacts.map((fact, index) => (
                <Reveal key={fact.marker} delayMs={index * 110}>
                  <div className="h-full border-2 border-border bg-background p-5 shadow-[4px_4px_0_var(--color-border)]">
                    <span className="inline-flex bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                      {fact.marker}
                    </span>
                    <p className="mt-3 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {fact.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {fact.description}
                    </p>
                  </div>
                </Reveal>
              ))}
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
                Autopilot,{" "}
                <span className="inline-block bg-accent px-[0.14em] text-black">
                  not copilot
                </span>
              </h2>
              <p className="max-w-3xl text-primary-foreground/72">
                A copilot waits for you to type a prompt. Harness AI
                doesn&apos;t wait. After every scan, five specialized agents
                wake in sequence, read a system brief composed from live facts
                and long-lived memory, and move the investigation forward on
                their own — deduping findings, building cases, tuning silent
                sources, even authoring the detectors you were missing. The
                fifth agent literally dreams: it consolidates what the others
                learned while nothing else is running.
              </p>
            </div>

            {/* The night shift: ring + missions */}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
              <div className="flex justify-center">
                <MissionRing />
              </div>
              <ol className="flex flex-col divide-y divide-primary-foreground/15 border-2 border-primary-foreground/25 bg-primary-foreground/5">
                {harnessMissions.map((mission) => (
                  <li
                    key={mission.step}
                    className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <span className="font-hero shrink-0 text-3xl uppercase leading-none text-accent sm:w-10">
                      {mission.step}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                          {mission.marker}
                        </span>
                        <span className="text-sm font-bold uppercase tracking-[0.04em]">
                          {mission.title}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-primary-foreground/65">
                        {mission.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1 sm:flex-col sm:items-end">
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
                  did and why. Watch one cycle play out — it&apos;s the same
                  credential-leak night from the story above, every decision
                  audited, every deliberate non-action recorded too.
                </p>
                <ul className="space-y-2 text-sm leading-6 text-primary-foreground/72">
                  <li className="border-l-2 border-accent pl-3">
                    <span className="font-bold text-primary-foreground">
                      Grounded in facts.
                    </span>{" "}
                    The system brief is composed by the server every cycle —
                    coverage, glossary, topics, gaps — from live counts plus
                    learned memory. Only the short overview is model-written.
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

            {/* Facts */}
            <div className="grid gap-3 md:grid-cols-3">
              {harnessFacts.map((fact, index) => (
                <Reveal key={fact.marker} delayMs={index * 110}>
                  <div className="h-full border-2 border-primary-foreground/30 bg-primary-foreground/8 p-5">
                    <span className="inline-flex bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                      {fact.marker}
                    </span>
                    <p className="mt-3 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {fact.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-primary-foreground/72">
                      {fact.description}
                    </p>
                  </div>
                </Reveal>
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
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-end">
              <div className="space-y-3">
                <Marker label="Deployment path" inverted />
                <h2
                  id="runtime-title"
                  className="font-serif text-4xl font-black uppercase leading-[0.9] tracking-wider sm:text-5xl"
                >
                  One product.
                  <br />
                  Two jurisdictions.
                </h2>
              </div>
              <p className="max-w-2xl text-muted-foreground">
                These aren&apos;t tiers, trials, or lite editions — each runtime
                is the full, productized platform. The desktop app keeps the
                investigation local; the Helm chart runs it remotely and scales
                as heavily as your estate demands.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Desktop */}
              <div className="panel-card flex h-full flex-col gap-4 rounded-[16px] bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      01 · Local · one install
                    </span>
                    <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
                      Desktop
                    </h3>
                  </div>
                  <span className="inline-flex shrink-0 border-2 border-accent bg-accent px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-black">
                    Full product
                  </span>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  The complete platform in a single install — PostgreSQL
                  embedded, every scan worker sandboxed under the hood. Not a
                  demo, not a trial: it&apos;s how a single investigator runs
                  Classifyre day to day, with everything on your machine.
                </p>
                <div className="grid gap-2">
                  {desktopDownloads.map((download) => (
                    <a
                      key={download.os}
                      href={desktopDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-baseline justify-between gap-2 border-2 border-border bg-background px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-[4px_4px_0_var(--color-accent)]"
                    >
                      <span className="font-mono text-sm font-bold uppercase tracking-[0.1em]">
                        {download.os}
                        <span className="text-accent-foreground/60 transition-colors group-hover:text-accent-foreground dark:text-accent">
                          {" "}
                          ↓
                        </span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {download.detail}
                      </span>
                    </a>
                  ))}
                </div>
                <p className="mt-auto pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Free · Open source · No signup, no cluster, no sales call
                </p>
              </div>

              {/* Kubernetes */}
              <div className="panel-card flex h-full flex-col gap-4 rounded-[16px] bg-foreground p-6 text-primary-foreground">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground/55">
                      02 · Remote · any size
                    </span>
                    <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
                      Helm on Kubernetes
                    </h3>
                  </div>
                  <span className="inline-flex shrink-0 border-2 border-accent px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                    Scales to any size
                  </span>
                </div>
                <p className="text-sm leading-6 text-primary-foreground/72">
                  The same open-source core, deployed remotely — self-hosted or
                  in your cloud — with properly separated components and
                  ephemeral processing workers that scale to zero between scans
                  and fan out as far as your estate goes. Your infrastructure,
                  your data.
                </p>
                <CommandBlock label="Helm install" lines={helmInstallCommand} />
                <div className="mt-auto pt-1">
                  <Button
                    asChild
                    variant="secondary"
                    className="w-full border-2 border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/16"
                  >
                    <a href={helmDocsUrl} target="_blank" rel="noreferrer">
                      Helm chart docs
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* Enterprise partnership */}
            <div className="relative overflow-hidden border-2 border-accent bg-background">
              <div className="landing-grid absolute inset-0 opacity-20" />
              <div className="relative space-y-6 p-6 sm:p-8">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      03 · When it becomes infrastructure
                    </span>
                    <h3 className="font-serif text-3xl font-black uppercase leading-[0.95] tracking-[0.04em] sm:text-4xl">
                      A partnership,
                      <br />
                      not a license key
                    </h3>
                  </div>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    The enterprise layer adds what a regulated, global rollout
                    needs — and it comes with us attached. Our engineers work
                    with your team from the first pilot: we learn how your
                    business names things, tune detection to your language, and
                    tailor Classifyre to the way your company actually works.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {enterprisePillars.map((pillar, index) => (
                    <Reveal key={pillar.marker} delayMs={index * 90}>
                      <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-4">
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
                    </Reveal>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    asChild
                    className="border-2 border-accent bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <a href={`mailto:${enterpriseContactEmail}`}>
                      Start the conversation
                    </a>
                  </Button>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {enterpriseContactEmail}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </LandingSectionShell>
      </section>

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
                Download the desktop app — or run one Docker command — point it
                at a system you already run, and see what the investigator
                finds. Everything stays on your machine, and everything you
                build carries over when you go remote with Helm.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  asChild
                  className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                >
                  <a href={desktopDownloadUrl} target="_blank" rel="noreferrer">
                    Download for macOS · Windows · Linux
                  </a>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
                >
                  <a
                    href="https://demo.classifyre.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
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
