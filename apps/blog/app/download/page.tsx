import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { HelmLogo, KubernetesLogo } from "@/components/brand-logos";
import {
  AllReleasesLink,
  DownloadPlatformGrid,
  DownloadPrimaryButton,
} from "@/components/download-links";
import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import { fetchLatestRelease, type OsKey } from "@/lib/releases";
import {
  demoUrl,
  docs,
  helmChartRef,
  repoUrl,
  routes,
  softwareVersion,
} from "@/lib/site";

import "../landing.css";

export const metadata: Metadata = {
  title: "Download & Install Classifyre",
  description:
    "Install Classifyre free: a desktop app for macOS, Windows, and Linux with PostgreSQL bundled, or the Helm chart on Kubernetes. Prerequisites, install commands, first-run steps, and upgrade guidance.",
  alternates: { canonical: routes.download },
  openGraph: {
    title: "Download & Install Classifyre",
    description:
      "Desktop app for macOS, Windows, and Linux, or a Helm chart on Kubernetes. Free and open source — no signup, no sales call.",
    type: "website",
  },
};

/**
 * Per-OS footnotes for the platform grid. The artifact, architecture, and
 * size shown on each tile come from the release itself — only the prose that
 * a release payload can't express lives here.
 */
const desktopPlatformNotes: Partial<Record<OsKey, string>> = {
  mac: "Signed and notarised, with in-app updates.",
  windows: "Self-contained archive — unzip and run.",
  linux: "Debian/Ubuntu and Fedora/RHEL families.",
};

/** What the desktop package brings with it, so nothing else is required. */
const desktopIncludes = [
  {
    title: "Workspaces",
    body: "Run isolated workspaces locally.",
  },
  {
    title: "Scan workers, sandboxed",
    body: "Extraction and detection run as isolated local processes — the same code the cluster runs as Kubernetes Jobs.",
  },
  {
    title: "Local folders as a source",
    body: "The desktop build can scan a directory on your machine, a source type the server build deliberately does not expose.",
  },
  {
    title: "Everything stays put",
    body: "Sources, credentials, findings, and cases live on your disk. Nothing is uploaded to us.",
  },
] as const;

const desktopSteps = [
  {
    step: "01",
    title: "Download and open",
    body: "Grab the build for your platform from GitHub Releases and install it the usual way. First launch initialises the embedded database — give it a few seconds.",
  },
  {
    step: "02",
    title: "Connect a source",
    body: "Point it at something you already run — a database, an S3 bucket, a Confluence space, or just a local folder. Credentials are encrypted at rest.",
    href: docs.sourceConfiguration,
    hrefLabel: "Configuring sources",
  },
  {
    step: "03",
    title: "Switch on detectors",
    body: "Enable the built-in packs you care about — PII, secrets, security, moderation, quality. They work on the first scan with no model setup.",
    href: docs.preBuiltDetectors,
    hrefLabel: "Pre-built detectors",
  },
  {
    step: "04",
    title: "Run a scan, open a case",
    body: "Findings land ranked by importance. Group them into inquiries and cases, or add an AI provider and let the autopilot work them between scans.",
    href: docs.aiProviders,
    hrefLabel: "AI providers",
  },
] as const;

const clusterPrerequisites = [
  { label: "Kubernetes", value: "≥ 1.26" },
  { label: "Helm", value: "≥ 3.8 (OCI native)" },
  { label: "Ingress", value: "nginx by default" },
  { label: "PostgreSQL", value: "14+ external, or embedded for demos" },
] as const;

const clusterDocs = [
  {
    title: "Kubernetes deployment guide",
    body: "Values files for k3s, an external database, and CloudNativePG; ingress, TLS, scaling, and storage.",
    href: docs.kubernetes,
  },
  {
    title: "Database",
    body: "Schema layout, migrations on upgrade, and connecting managed PostgreSQL.",
    href: docs.database,
  },
  {
    title: "Object storage",
    body: "Optional buckets for scan logs and uploaded artifacts.",
    href: docs.storage,
  },
  {
    title: "Upgrades & versioning",
    body: "How image tags track the chart appVersion, and what a version bump implies.",
    href: docs.upgrades,
  },
] as const;

function CommandBlock({
  label,
  lines,
}: {
  label: string;
  lines: readonly string[];
}) {
  return (
    <div className="min-w-0">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground/55">
        {label}
      </span>
      {/* min-w-0 lets the pre's own overflow-x-auto win: without it the
          unbreakable OCI ref would size the whole grid track. */}
      <pre className="mt-2 min-w-0 overflow-x-auto border-2 border-primary-foreground/20 bg-primary-foreground/8 px-3 py-3 font-mono text-[11px] leading-6 text-primary-foreground/85 sm:text-xs">
        <code>{lines.join("\n")}</code>
      </pre>
    </div>
  );
}

export default async function DownloadPage() {
  // Resolved at build time so the exported HTML links straight at the release
  // assets; DownloadPlatformGrid refreshes it client-side.
  const latestRelease = await fetchLatestRelease();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        title={
          <>
            Get it running
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              tonight.
            </span>
          </>
        }

        aside={
          <div className="flex flex-col items-start gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href="#desktop">Desktop app</a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href="#kubernetes">Kubernetes</a>
              </Button>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">
              v{latestRelease?.version ?? softwareVersion} · free · no signup
            </span>
          </div>
        }
      />

      {/* ── Desktop ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="desktop-title" id="desktop">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="desktop-title"
              marker="Option 01 · Desktop"
              title="Install it on your machine"
              lede="One installer. The database and the scan workers are already inside, so there is nothing to provision and nothing to connect."
            />

            <DownloadPlatformGrid
              release={latestRelease}
              size="full"
              notes={desktopPlatformNotes}
            />

            <div className="flex flex-col items-center gap-3">
              <div className="w-full max-w-md">
                <DownloadPrimaryButton release={latestRelease} />
              </div>
              <AllReleasesLink release={latestRelease} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {desktopIncludes.map((item, index) => (
                <Reveal key={item.title} delayMs={index * 70}>
                  <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-5">
                    <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                      {item.title}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── First run ────────────────────────────────────────────────────── */}
      <section aria-labelledby="first-run-title">
        <SectionShell tone="signal">
          <div className="space-y-8">
            <SectionHead
              id="first-run-title"
              marker="First run"
              tone="signal"
              illustration="check-list"
              title="Four steps to your first finding"
              lede="Nothing here needs a config file. Every step is in the app, and each one has a page on the docs site when you want the detail."
              action={
                <DocsLink href={docs.inTheApp} tone="signal">
                  Tour the app
                </DocsLink>
              }
            />

            <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {desktopSteps.map((item, index) => (
                <Reveal key={item.step} as="li" delayMs={index * 80}>
                  <div className="flex h-full flex-col gap-3 border-2 border-primary-foreground/25 bg-primary-foreground/8 p-5">
                    <span className="font-mono text-3xl font-black text-primary-foreground/20">
                      {item.step}
                    </span>
                    <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                      {item.title}
                    </p>
                    <p className="text-sm leading-6 text-primary-foreground/68">
                      {item.body}
                    </p>
                    {"href" in item && item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent underline-offset-4 hover:underline dark:text-accent-foreground"
                      >
                        {item.hrefLabel} →
                      </a>
                    ) : null}
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </SectionShell>
      </section>

      {/* ── Kubernetes ───────────────────────────────────────────────────── */}
      <section aria-labelledby="kubernetes-title" id="kubernetes">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="kubernetes-title"
              marker="Option 02 · Kubernetes"
              title="Or scale it on your cluster"
              lede="The same open-source core as a Helm chart — web, API, worker, and ephemeral scan Jobs that fan out under load and scale to zero between runs."
              action={
                <DocsLink href={docs.kubernetes}>
                  Full deployment guide
                </DocsLink>
              }
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              {/* Install */}
              <div className="flex min-w-0 flex-col gap-6 border-2 border-foreground bg-foreground p-6 text-primary-foreground shadow-[6px_6px_0_var(--color-accent)] sm:p-8">
                <div className="flex items-center gap-6">
                  <KubernetesLogo className="h-14 w-14 shrink-0 text-accent sm:h-16 sm:w-16 dark:text-accent-foreground" />
                  <HelmLogo className="h-14 w-14 shrink-0 text-accent sm:h-16 sm:w-16 dark:text-accent-foreground" />
                  <div className="min-w-0">
                    <p className="font-serif text-xl font-black uppercase leading-tight tracking-[0.04em]">
                      Helm, OCI-native
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-primary-foreground/60">
                      No repo add step
                    </p>
                  </div>
                </div>

                <CommandBlock
                  label="Inspect before installing"
                  lines={[`helm show chart ${helmChartRef}`]}
                />
                <CommandBlock
                  label="Install"
                  lines={[
                    "helm install classifyre \\",
                    `  ${helmChartRef} \\`,
                    "  --namespace classifyre --create-namespace \\",
                    `  --version ${softwareVersion} \\`,
                    "  -f values.yaml",
                  ]}
                />

              </div>

              {/* Prerequisites + images */}
              <div className="flex min-w-0 flex-col gap-4">
                <div className="border-2 border-border bg-background">
                  <div className="border-b-2 border-border px-5 py-3">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent-foreground/70 dark:text-accent">
                      Prerequisites
                    </span>
                  </div>
                  <dl className="divide-y-2 divide-border">
                    {clusterPrerequisites.map((item) => (
                      <div
                        key={item.label}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3"
                      >
                        <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em]">
                          {item.label}
                        </dt>
                        <dd className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="border-2 border-border bg-background">
                  <div className="border-b-2 border-border px-5 py-3">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent-foreground/70 dark:text-accent">
                      Images · multi-arch
                    </span>
                  </div>

                  <p className="border-t-2 border-border px-5 py-3 font-mono text-[10px] uppercase leading-5 tracking-[0.1em] text-muted-foreground">
                    linux/amd64 + linux/arm64
                  </p>
                </div>
              </div>
            </div>

            {/* Deeper reading, straight to the docs */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {clusterDocs.map((item, index) => (
                <Reveal key={item.href} delayMs={index * 70}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-full flex-col gap-2 border-2 border-border bg-background p-5 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-[4px_4px_0_var(--color-accent)]"
                  >
                    <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                      {item.title}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {item.body}
                    </p>
                    <span className="mt-auto pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-foreground/70 dark:text-accent">
                      Read the docs →
                    </span>
                  </a>
                </Reveal>
              ))}
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Which one ────────────────────────────────────────────────────── */}
      <section aria-labelledby="which-title">
        <SectionShell tone="plain">
          <div className="space-y-6">
            <SectionHead
              id="which-title"
              marker="Not sure which"
              illustration="settings"
              title="Pick by where the data has to stay"
              lede="Both runtimes carry the same features, and a namespace export moves your work from one to the other, so this is not a decision you are locked into."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  head: "Choose desktop when",
                  tone: "accent" as const,
                  points: [
                    "You are evaluating, or you investigate alone.",
                    "The corpus is on your machine or reachable from it.",
                    "Nothing may leave the laptop.",
                    "You want to be scanning within ten minutes.",
                  ],
                },
                {
                  head: "Choose Kubernetes when",
                  tone: "plain" as const,
                  points: [
                    "A team shares the instance, split into workspaces.",
                    "Scans need to run on a schedule, unattended.",
                    "The estate is large enough to need workers fanning out.",
                    "It has to sit inside your existing cluster and network.",
                  ],
                },
              ].map((card) => (
                <div
                  key={card.head}
                  className={cn(
                    "flex flex-col gap-4 border-2 bg-background p-6",
                    card.tone === "accent"
                      ? "border-accent shadow-[6px_6px_0_var(--color-accent)]"
                      : "border-border shadow-[6px_6px_0_var(--color-border)]",
                  )}
                >
                  <h3 className="font-serif text-xl font-black uppercase tracking-[0.04em]">
                    {card.head}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {card.points.map((point) => (
                      <li
                        key={point}
                        className="flex gap-3 text-sm leading-6 text-muted-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 bg-accent"
                        />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-l-2 border-accent pl-5">
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Wondering what the enterprise layer adds on top of either
                runtime? It is SSO, roles, and per-workspace authorization — not
                features held back from the open-source core.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={routes.editions}>Open source vs Enterprise</a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="download-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">

            <h2
              id="download-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Point it at something{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                real.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              The fastest honest test is a system you already run. Install it,
              connect one source, and see what the investigator turns up.
            </p>
            <div className="flex w-full flex-wrap items-start justify-center gap-3">
              <div className="w-full max-w-xs">
                {/* Black section: the caption under the button defaults to
                    muted-foreground, which is unreadable here. */}
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
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white/50">
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Source on GitHub
              </a>
              <a
                href={routes.sources}
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Supported sources
              </a>
              <a
                href={docs.root}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Documentation
              </a>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
