import type { Metadata } from "next";
import Link from "next/link";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Classifyre documentation — how the app works, section by section: connect sources, scan them, review findings, and investigate what matters.",
  openGraph: {
    title: "Documentation | Classifyre",
    description:
      "Connect sources, scan them, review findings, and investigate what matters — with an AI autopilot doing the legwork.",
  },
};

const docSections = [
  {
    title: "How It Works",
    badge: "START HERE",
    description:
      "The whole platform in plain English — how scattered data becomes a small number of leads worth your time, and a tour of every screen in the app.",
    href: "/docs/how-it-works/",
    items: [
      { label: "The big picture", href: "/docs/how-it-works/" },
      { label: "A tour of the app", href: "/docs/how-it-works/in-the-app/" },
      {
        label: "From documents to findings",
        href: "/docs/how-it-works/documents-to-findings/",
      },
      {
        label: "Glossary & shared vocabulary",
        href: "/docs/how-it-works/glossary/",
      },
    ],
  },
  {
    title: "Sources",
    badge: "CONNECT",
    description:
      "Connect the systems you already run — SharePoint, Confluence, Jira, databases, file shares, and more. Nothing is moved; Classifyre reads data in place.",
    href: "/docs/sources/",
    items: [
      { label: "Source catalog & overview", href: "/docs/sources/" },
      { label: "Configuration & fields", href: "/docs/sources/configuration/" },
      { label: "Testing & scheduling", href: "/docs/sources/testing/" },
      {
        label: "Assets & metadata",
        href: "/docs/sources/assets-and-metadata/",
      },
    ],
  },
  {
    title: "Detectors",
    badge: "DETECT",
    description:
      "Ready-made packs for secrets, personal data, and security — plus custom detectors you build yourself, from a simple pattern to a full AI model.",
    href: "/docs/detectors/",
    items: [
      { label: "Pre-built detectors", href: "/docs/detectors/pre-built/" },
      { label: "Custom detectors", href: "/docs/detectors/custom-detectors/" },
      { label: "Findings & results", href: "/docs/detectors/findings/" },
    ],
  },
  {
    title: "Scans",
    badge: "RUN",
    description:
      "What happens between pressing “scan” and seeing findings — the phases of a run, the statuses you'll see, and how repeat scans stay accurate.",
    href: "/docs/flow/",
    items: [
      { label: "The journey of a scan", href: "/docs/flow/" },
      { label: "Sampling strategies", href: "/docs/sources/sampling/" },
      {
        label: "OCR & transcription",
        href: "/docs/sources/content-extraction/",
      },
    ],
  },
  {
    title: "Investigations",
    badge: "CORE WORKFLOW",
    description:
      "Where findings become answers: inquiries keep watch, fingerprints connect duplicates across systems, and cases collect evidence toward a conclusion.",
    href: "/docs/investigations/",
    items: [
      { label: "Overview", href: "/docs/investigations/" },
      { label: "Inquiries", href: "/docs/investigations/inquiry/" },
      { label: "Fingerprints", href: "/docs/investigations/fingerprints/" },
      { label: "Cases & hypotheses", href: "/docs/investigations/cases/" },
    ],
  },
  {
    title: "Autopilot",
    badge: "AI AGENTS",
    description:
      "AI agents that do the legwork after every scan — triaging findings, building cases, drafting hypotheses — with a written reason for every action.",
    href: "/docs/investigations/autopilot/",
    items: [
      {
        label: "What the autopilot does",
        href: "/docs/investigations/autopilot/",
      },
      {
        label: "Meet the agents",
        href: "/docs/investigations/autopilot/agents/",
      },
      {
        label: "Steering & supervision",
        href: "/docs/investigations/autopilot/steering/",
      },
      {
        label: "Flight recorder & audit",
        href: "/docs/investigations/autopilot/flight-recorder/",
      },
    ],
  },
  {
    title: "Staying Informed",
    badge: "OUTPUTS",
    description:
      "Notifications for the events worth knowing about, and exports that put findings into Excel, Google Sheets, or your BI tool — as a snapshot or a live feed.",
    href: "/docs/notifications/",
    items: [
      { label: "Notifications", href: "/docs/notifications/" },
      { label: "Data export", href: "/docs/data-export/" },
    ],
  },
  {
    title: "Setup & Administration",
    badge: "ADMIN",
    description:
      "Instance settings, AI provider credentials, and the MCP server — plus running Classifyre with Docker on a laptop or Kubernetes in production.",
    href: "/docs/settings/",
    items: [
      { label: "Settings & AI providers", href: "/docs/settings/" },
      { label: "MCP server", href: "/docs/settings/mcp-server/" },
      { label: "Docker (try it out)", href: "/docs/deployment/docker/" },
      {
        label: "Kubernetes (production)",
        href: "/docs/deployment/kubernetes/",
      },
    ],
  },
];

export default function DocsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="mb-10 space-y-3">
        <Badge
          variant="secondary"
          className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
        >
          Documentation
        </Badge>
        <h1 className="font-serif text-4xl font-black uppercase tracking-[0.08em] sm:text-5xl">
          Connect. Scan. Investigate.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          These docs explain how Classifyre works, section by section: connect
          the systems you already run, let scans and detectors surface what
          matters, then work the results as investigations — with an AI
          autopilot doing the legwork in between. New here? Start with{" "}
          <Link
            href="/docs/how-it-works/"
            className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-2"
          >
            How It Works
          </Link>
          .
        </p>
      </header>

      {/* ── Doc sections grid ──────────────────────────────────────── */}
      <section className="grid gap-5 md:grid-cols-2">
        {docSections.map((section) => (
          <Card key={section.title} className="panel-card flex flex-col">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center border-2 border-border bg-background px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-foreground">
                  {section.badge}
                </span>
                <CardTitle className="text-2xl leading-tight">
                  {section.title}
                </CardTitle>
              </div>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-3">
              <ul className="space-y-1.5">
                {section.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-sm text-muted-foreground underline underline-offset-2 decoration-border hover:text-foreground hover:decoration-accent transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant="secondary"
                className="w-full border-2 border-border"
              >
                <Link href={section.href}>View {section.title} docs</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
