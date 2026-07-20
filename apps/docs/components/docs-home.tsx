import Link from "next/link";

const PIPELINE: Array<{
  step: string;
  name: string;
  blurb: string;
  href: string;
}> = [
  {
    step: "01",
    name: "Connect",
    blurb: "Point Classifyre at systems you already run. Data stays in place.",
    href: "/sources/",
  },
  {
    step: "02",
    name: "Scan",
    blurb: "Each run registers every document and file as an asset.",
    href: "/flow/",
  },
  {
    step: "03",
    name: "Detect",
    blurb: "Detectors read every asset and raise findings worth a look.",
    href: "/detectors/",
  },
  {
    step: "04",
    name: "Connect the dots",
    blurb: "Inquiries keep watch; fingerprints link the same thing everywhere.",
    href: "/investigations/",
  },
  {
    step: "05",
    name: "Resolve",
    blurb: "Cases collect evidence, weigh hypotheses, and reach a conclusion.",
    href: "/investigations/cases/",
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
      "The whole platform in plain English — no setup, no jargon, just how a pile of scattered data becomes three leads worth your time.",
    links: [
      { text: "How Classifyre works", href: "/how-it-works/" },
      { text: "A tour of the app", href: "/how-it-works/in-the-app/" },
      {
        text: "From documents to findings",
        href: "/how-it-works/documents-to-findings/",
      },
    ],
  },
  {
    label: "Setting it up",
    title: "Run it",
    blurb:
      "Stand the platform up, connect your first system, and watch the first scan land — on a laptop or in production.",
    links: [
      { text: "Deploy with Kubernetes", href: "/deployment/kubernetes/" },
      { text: "Connect a source", href: "/sources/" },
      { text: "Your first scan", href: "/flow/" },
    ],
  },
  {
    label: "Working results",
    title: "Investigate",
    blurb:
      "Findings are the start, not the answer. Watch them with inquiries, connect them with fingerprints, and close them as cases.",
    links: [
      { text: "Investigations overview", href: "/investigations/" },
      { text: "Cases & hypotheses", href: "/investigations/cases/" },
      { text: "Put it on Autopilot", href: "/investigations/autopilot/" },
    ],
  },
];

const DIRECTORY: Array<{ name: string; blurb: string; href: string }> = [
  {
    name: "How It Works",
    blurb: "The plain-English map of the whole platform, screen by screen.",
    href: "/how-it-works/",
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
    name: "Investigations",
    blurb: "Inquiries, fingerprints, cases, hypotheses — and the AI autopilot.",
    href: "/investigations/",
  },
  {
    name: "Notifications",
    blurb: "The events worth telling you about, and how to tune them.",
    href: "/notifications/",
  },
  {
    name: "Data Export",
    blurb: "CSV downloads and live feeds into Excel, Sheets, or BI tools.",
    href: "/data-export/",
  },
  {
    name: "Settings",
    blurb: "Locale, AI providers, and the MCP server for your own tools.",
    href: "/settings/",
  },
  {
    name: "Deployment",
    blurb: "Helm deployment for local and production Kubernetes clusters.",
    href: "/deployment/",
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
          Scattered data
          <br />
          in.{" "}
          <span className="bg-accent px-2 text-accent-foreground">
            Closed cases
          </span>{" "}
          out.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-7 text-muted-foreground">
          Classifyre reads the systems you already run, raises the findings
          worth a human&apos;s time, and gives you a structured place to work
          them — with an AI autopilot doing the legwork between scans. These
          docs explain how the application works, section by section.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/how-it-works/"
            className="border-2 border-border bg-accent px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-accent-foreground transition-transform hover:-translate-y-0.5"
          >
            Start: how it works →
          </Link>
          <Link
            href="/deployment/kubernetes/"
            className="border-2 border-border bg-background px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Install with Helm
          </Link>
        </div>
      </header>

      {/* ── Pipeline strip ───────────────────────────────────────── */}
      <section aria-labelledby="pipeline-heading" className="py-10">
        <h2
          id="pipeline-heading"
          className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground"
        >
          One pipeline, five steps
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
