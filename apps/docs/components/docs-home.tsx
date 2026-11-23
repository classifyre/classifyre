import Link from "next/link";

import { InstallOptions } from "./install-options";

const PIPELINE: Array<{
  step: string;
  name: string;
  blurb: string;
  href: string;
}> = [
  {
    step: "01",
    name: "Connect",
    blurb: "Integrate 40+ databases, lakehouses (Iceberg, Delta, Parquet), and file stores in place.",
    href: "/sources/",
  },
  {
    step: "02",
    name: "Detect",
    blurb: "Classify PII, secrets, and custom business rules with regex, Python, local AI, or LLMs.",
    href: "/detectors/",
  },
  {
    step: "03",
    name: "Govern & mask",
    blurb: "Map directory groups to row filters, multi-level column masks, and time-limited grants.",
    href: "/access/",
  },
  {
    step: "04",
    name: "Query & BI",
    blurb: "Serve live SQL, Power BI, Excel, ODBC, and MCP agents through personal connections.",
    href: "/sql-connections/",
  },
  {
    step: "05",
    name: "Share & audit",
    blurb: "Publish governed shared datasets with inherited masks and log every read automatically.",
    href: "/data-query/#shared-datasets",
  },
];

const START_HERE: Array<{
  label: string;
  title: string;
  blurb: string;
  links: Array<{ text: string; href: string }>;
}> = [
  {
    label: "New here",
    title: "Understand it",
    blurb:
      "How Classifyre governs data end to end — from connecting existing systems and directory groups to masking, SQL/BI access, and governed data products.",
    links: [
      { text: "How Classifyre works", href: "/how-it-works/" },
      { text: "Isolated workspaces", href: "/how-it-works/workspaces/" },
      { text: "A tour of the app", href: "/how-it-works/in-the-app/" },
      { text: "Roles & directory access", href: "/access/" },
    ],
  },
  {
    label: "Setting it up",
    title: "Deploy it",
    blurb:
      "Evaluate locally with Docker or deploy to Kubernetes and OpenShift with Helm — on-premises or in your own cloud.",
    links: [
      { text: "Run it with Docker", href: "/deployment/docker/" },
      { text: "Deploy on Kubernetes & OpenShift", href: "/deployment/kubernetes/" },
      { text: "Connect a source", href: "/sources/" },
      { text: "Configure detectors", href: "/detectors/" },
    ],
  },
  {
    label: "Governing data",
    title: "Use it",
    blurb:
      "Apply group-based row filters and column masks, connect Power BI and Excel, publish shared datasets, and review the audit log.",
    links: [
      { text: "SQL, masking & shared datasets", href: "/data-query/" },
      { text: "Power BI, Excel & ODBC connections", href: "/sql-connections/" },
      { text: "Organizing groups & roles", href: "/access/organizing/" },
      { text: "Incident response (Add-on)", href: "/investigations/" },
    ],
  },
];

const DIRECTORY: Array<{ name: string; blurb: string; href: string }> = [
  {
    name: "How It Works",
    blurb:
      "The plain-English map of the whole platform, from isolated workspaces down to each screen.",
    href: "/how-it-works/",
  },
  {
    name: "Install & Deploy",
    blurb:
      "The two distributions: the all-in-one Docker image, and the Helm chart for local and production clusters.",
    href: "/deployment/",
  },
  {
    name: "Sources",
    blurb: "Every system you can connect, and how to configure each one.",
    href: "/sources/",
  },
  {
    name: "Detectors",
    blurb: "Pre-built packs plus custom detectors, from regex to full AI.",
    href: "/detectors/",
  },
  {
    name: "Scans",
    blurb: "What a scan actually does, and how repeat runs stay accurate.",
    href: "/flow/",
  },
  {
    name: "Access & Sign-in",
    blurb: "Directory SSO, groups, roles, expiring grants, and per-workspace permissions.",
    href: "/access/",
  },
  {
    name: "SQL & Masking",
    blurb: "Cross-source SQL, multi-level column masks, row filters, and governed shared datasets.",
    href: "/data-query/",
  },
  {
    name: "SQL Connections",
    blurb: "Personal, expiring TLS connections for Power BI, Excel, Tableau, DBeaver, and ODBC.",
    href: "/sql-connections/",
  },
  {
    name: "Data Export",
    blurb: "CSV downloads of findings, assets and scan assets.",
    href: "/data-export/",
  },
  {
    name: "Notifications",
    blurb: "The events worth telling you about, and how to tune them.",
    href: "/notifications/",
  },
  {
    name: "Investigations (Add-on)",
    blurb: "Optional incident response module: inquiries, cases, hypotheses, and supervised autopilot.",
    href: "/investigations/",
  },
  {
    name: "Duplicate review",
    blurb: "Assets that look like the same thing, queued so the list can be finished.",
    href: "/duplicates/",
  },
  {
    name: "Settings",
    blurb: "Locale, scan limits, SQL limits, and the MCP server.",
    href: "/settings/",
  },
];

export function DocsHome() {
  return (
    <div className="not-prose mx-auto max-w-5xl">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <header className="border-b-2 border-border pb-10 pt-4">
        <p className="mb-6 inline-block border-2 border-border bg-background px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.22em]">
          Classifyre · Documentation
        </p>
        <h1
          className="text-[17vw] leading-[0.88] uppercase sm:text-7xl md:text-8xl"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          Control who sees what.
          <br />
          Enforced on{" "}
          <span className="bg-accent px-2 text-accent-foreground">
            every query.
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-7 text-muted-foreground">
          Classifyre is an open-source data governance platform you run on your
          own infrastructure. Integrate your existing sources and directory
          groups, detect sensitive and business-specific data, enforce column
          and row masking, publish governed data products, and give teams live
          SQL, Power BI, and Excel access with every read logged.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#install"
            className="border-2 border-border bg-accent px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-accent-foreground transition-transform hover:-translate-y-0.5"
          >
            Get Classifyre ↓
          </a>
          <Link
            href="/how-it-works/"
            className="border-2 border-border bg-background px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            How it works
          </Link>
        </div>
      </header>

      {/* ── Install ──────────────────────────────────────────────── */}
      <section id="install" aria-labelledby="install-heading" className="py-10">
        <h2
          id="install-heading"
          className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground"
        >
          Step zero — get it running
        </h2>
        <p className="mb-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          Classifyre ships in two distributions, with the same features in
          both. Install one, then work through the pipeline below.
        </p>
        <InstallOptions />
      </section>

      {/* ── Pipeline strip ───────────────────────────────────────── */}
      <section aria-labelledby="pipeline-heading" className="py-10">
        <h2
          id="pipeline-heading"
          className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground"
        >
          Then: one path, five steps
        </h2>
        <ol className="grid grid-cols-1 border-2 border-border sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((stage, i) => (
            <li
              key={stage.step}
              className={
                i > 0
                  ? "border-t-2 border-border sm:border-t-0 sm:border-l-2"
                  : ""
              }
            >
              <Link
                href={stage.href}
                className="group flex h-full flex-col gap-2 p-4 transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span
                  className="text-4xl leading-none text-muted-foreground group-hover:text-accent-foreground"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {stage.step}
                </span>
                <span className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                  {stage.name}
                </span>
                <span className="text-xs leading-5 text-muted-foreground group-hover:text-accent-foreground">
                  {stage.blurb}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Start here ───────────────────────────────────────────── */}
      <section aria-labelledby="start-heading" className="pb-10">
        <h2
          id="start-heading"
          className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground"
        >
          Start where you are
        </h2>
        <div className="grid gap-5 md:grid-cols-3">
          {START_HERE.map((entry) => (
            <article
              key={entry.title}
              className="flex flex-col border-2 border-border bg-card shadow-[4px_4px_0_0_var(--border)]"
            >
              <p className="border-b-2 border-border bg-muted/40 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {entry.label}
              </p>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <h3
                  className="break-normal text-4xl uppercase leading-none [overflow-wrap:normal]"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {entry.title}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {entry.blurb}
                </p>
                <ul className="mt-auto space-y-1.5 pt-2">
                  {entry.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="font-mono text-[13px] font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-4 hover:bg-accent hover:text-accent-foreground"
                      >
                        {link.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Section directory ────────────────────────────────────── */}
      <section aria-labelledby="directory-heading" className="pb-12">
        <h2
          id="directory-heading"
          className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground"
        >
          Every section
        </h2>
        <div className="grid grid-cols-1 border-t-2 border-l-2 border-border sm:grid-cols-2 lg:grid-cols-3">
          {DIRECTORY.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group flex flex-col gap-1.5 border-r-2 border-b-2 border-border p-4 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="flex items-baseline justify-between font-serif text-base font-black uppercase tracking-[0.05em]">
                {section.name}
                <span
                  aria-hidden
                  className="font-mono text-sm opacity-0 transition-opacity group-hover:opacity-100"
                >
                  →
                </span>
              </span>
              <span className="text-xs leading-5 text-muted-foreground group-hover:text-accent-foreground">
                {section.blurb}
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Looking for a specific connector or detector? The{" "}
          <Link
            href="/sources/"
            className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3"
          >
            source catalog
          </Link>{" "}
          and{" "}
          <Link
            href="/detectors/pre-built/"
            className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3"
          >
            detector catalog
          </Link>{" "}
          are generated straight from the product, so they are always current.
        </p>
      </section>
    </div>
  );
}
