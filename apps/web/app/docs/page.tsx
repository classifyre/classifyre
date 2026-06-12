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
    "Classifyre documentation — learn how to investigate your data estate with inquiries, cases, hypotheses, and AI autopilot.",
  openGraph: {
    title: "Documentation | Classifyre",
    description:
      "Connect sources, configure detectors, work investigations, and deploy at scale.",
  },
};

const docSections = [
  {
    title: "Investigations",
    badge: "CORE WORKFLOW",
    description:
      "Inquiries, cases, hypotheses, timeline, and the knowledge graph — the full investigation workflow that turns findings into resolved incidents.",
    href: "/docs/flow/investigations/",
    items: [
      { label: "Inquiry & Case overview", href: "/docs/flow/investigations/" },
      { label: "Inquiry matchers", href: "/docs/flow/investigations/inquiry/" },
      { label: "Case workspace", href: "/docs/flow/investigations/cases/" },
      { label: "Hypothesis & Threads", href: "/docs/flow/investigations/cases/hypothesis/" },
      { label: "Knowledge Graph", href: "/docs/flow/investigations/cases/graph/" },
      { label: "Timeline", href: "/docs/flow/investigations/cases/timeline/" },
    ],
  },
  {
    title: "Autopilot",
    badge: "AI AGENTS",
    description:
      "Autonomous inquiry and case agents that wake after every scan — no prompt required. Every decision explained in the flight recorder.",
    href: "/docs/flow/investigations/autopilot/",
    items: [
      { label: "Architecture & pipeline", href: "/docs/flow/investigations/autopilot/" },
      { label: "Inquiry agent actions", href: "/docs/flow/investigations/autopilot/" },
      { label: "Case agent actions", href: "/docs/flow/investigations/autopilot/" },
      { label: "Memory & flight recorder", href: "/docs/flow/investigations/autopilot/" },
    ],
  },
  {
    title: "Sources",
    badge: "CONNECTORS",
    description:
      "Connect databases, lakehouses, collaboration tools, analytics systems, and web content — all feeding evidence into the same investigation layer.",
    href: "/docs/sources/",
    items: [
      { label: "Source configuration", href: "/docs/sources/" },
      { label: "Scan lifecycle", href: "/docs/flow/" },
      { label: "Asset ingestion & diffing", href: "/docs/flow/" },
    ],
  },
  {
    title: "Detectors",
    badge: "EVIDENCE PIPELINE",
    description:
      "Built-in packs for PII, secrets, and security — plus four custom engines from regex to any LLM. Every rung feeds the same findings stream.",
    href: "/docs/detectors/",
    items: [
      { label: "Pre-built detectors", href: "/docs/detectors/" },
      { label: "Custom detectors", href: "/docs/detectors/custom-detectors/" },
      { label: "Detector ladder", href: "/docs/detectors/custom-detectors/" },
    ],
  },
  {
    title: "Flow",
    badge: "LIFECYCLE",
    description:
      "End-to-end lifecycle from source creation to findings — entity model, scan run phases, state machines for assets and findings.",
    href: "/docs/flow/",
    items: [
      { label: "Entity model", href: "/docs/flow/" },
      { label: "Source & scan lifecycle", href: "/docs/flow/" },
      { label: "Finding lifecycle", href: "/docs/flow/" },
    ],
  },
  {
    title: "Deployment",
    badge: "OPERATIONS",
    description:
      "Run locally with Docker, deploy to production on Kubernetes with Helm, or add the enterprise layer for governance and SLA-backed support.",
    href: "/docs/deployment/",
    items: [
      { label: "Docker (dev/demo)", href: "/docs/deployment/docker/" },
      { label: "Kubernetes (production)", href: "/docs/deployment/kubernetes/" },
      { label: "PostgreSQL & S3 config", href: "/docs/deployment/database/" },
      { label: "Upgrade & versioning", href: "/docs/deployment/upgrade-and-versioning/" },
    ],
  },
  {
    title: "Settings",
    badge: "REFERENCE",
    description:
      "Instance configuration, AI provider setup, MCP server config, and notification channels.",
    href: "/docs/settings/",
    items: [
      { label: "Instance settings", href: "/docs/settings/instance-settings/" },
      { label: "AI providers", href: "/docs/settings/ai-providers/" },
      { label: "MCP server", href: "/docs/settings/mcp-server/" },
      { label: "Notifications", href: "/docs/notifications/" },
    ],
  },
  {
    title: "Data Export",
    badge: "INTEGRATION",
    description:
      "Export findings, assets, and investigation data for external analysis and reporting.",
    href: "/docs/data-export/",
    items: [
      { label: "Export overview", href: "/docs/data-export/" },
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
          Detect. Investigate. Resolve.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Classifyre is an open-source investigation platform — detectors
          surface evidence, inquiries keep watch, cases and hypotheses organise
          the work, and an AI autopilot does the legwork between scans. This
          documentation covers the full platform.
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
                <Link href={section.href}>
                  View {section.title} docs
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
