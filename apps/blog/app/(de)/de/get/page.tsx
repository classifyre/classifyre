import type { Metadata } from "next";

import {
  Button,
  DockerLogo,
  DockerRunBlock,
  dockerImageTag,
  dockerRunLines,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { getDockerNotes } from "@/i18n";
import deTranslations from "@/i18n/de.json";
import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  docs,
  helmChartRef,
  repoUrl,
  routes,
  showcaseUrlFor,
  softwareVersion,
} from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Classifyre holen",
  description:
    "Classifyre kostenlos betreiben: ein Docker-Image mit Datenbank, UI und Scan-Workern darin, oder der Helm-Chart auf Kubernetes. Voraussetzungen, Run-Befehl, erste Schritte und Upgrade-Hinweise.",
  alternates: {
    canonical: "/de/get/",
    languages: {
      en: "/get/",
      de: "/de/get/",
      "x-default": "/get/",
    },
  },
  openGraph: {
    title: "Classifyre holen",
    description:
      "Ein docker run auf macOS, Windows oder Linux, oder ein Helm-Chart auf Kubernetes. Kostenlos und Open Source — keine Anmeldung, kein Sales-Anruf.",
    type: "website",
  },
};

/** What the image brings with it, so nothing else has to be provisioned. */
const dockerIncludes = [
  {
    title: "PostgreSQL, drinnen",
    body: "Die Datenbank steckt im Image, beim Start abgestimmt auf das Memory, das Sie dem Container gegeben haben. Zeigen Sie mit DATABASE_URL auf Ihren eigenen Server, wenn Sie herauswachsen.",
  },
  {
    title: "Scan-Worker, gesandboxt",
    body: "Extraktion und Detektion laufen als eigene Prozesse, die mit dem Scan enden — derselbe Code, den der Cluster als Kubernetes-Jobs fährt.",
  },
  {
    title: "Ordner mounten, scannen",
    body: "Mounten Sie ein Verzeichnis read-only und zeigen Sie mit einer Quelle darauf. Nichts wird herauskopiert; die Dateien werden gelesen, wo sie liegen.",
  },
  {
    title: "Alles bleibt liegen",
    body: "Quellen, Credentials, Befunde und Fälle leben in Volumes auf Ihrer Platte. Nichts wird zu uns hochgeladen.",
  },
] as const;

const firstRunSteps = [
  {
    step: "01",
    title: "Image starten",
    body: "Ein Befehl, dann localhost:3000 öffnen. Der erste Boot initialisiert die Datenbank und legt einen Workspace an — geben Sie ihm auf einem Laptop ein paar Minuten.",
  },
  {
    step: "02",
    title: "Quelle anbinden",
    body: "Zeigen Sie auf etwas, das Sie bereits betreiben — eine Datenbank, einen S3-Bucket, einen Confluence-Space oder einfach einen lokalen Ordner. Credentials sind at rest verschlüsselt.",
    href: docs.sourceConfiguration,
    hrefLabel: "Quellen konfigurieren",
  },
  {
    step: "03",
    title: "Detektoren einschalten",
    body: "Aktivieren Sie die Built-in-Packs, die Sie interessieren — PII, Secrets, Security, Moderation, Qualität. Sie greifen beim ersten Scan, ganz ohne Modell-Setup.",
    href: docs.preBuiltDetectors,
    hrefLabel: "Vorgefertigte Detektoren",
  },
  {
    step: "04",
    title: "Scannen, Fall eröffnen",
    body: "Befunde landen nach Wichtigkeit gereiht. Gruppieren Sie sie in Anfragen und Fälle, oder binden Sie einen KI-Anbieter an und lassen Sie den Autopiloten sie zwischen den Scans bearbeiten.",
    href: docs.aiProviders,
    hrefLabel: "KI-Anbieter",
  },
] as const;

const clusterPrerequisites = [
  { label: "Kubernetes", value: "≥ 1.26" },
  { label: "Helm", value: "≥ 3.8 (OCI-nativ)" },
  { label: "Ingress", value: "default: nginx" },
  { label: "PostgreSQL", value: "14+, extern, oder eingebettet für Demos" },
] as const;

const clusterDocs = [
  {
    title: "Kubernetes-Deployment-Anleitung",
    body: "Values-Files für k3s, externe Datenbank und CloudNativePG; Ingress, TLS, Skalierung und Storage.",
    href: docs.kubernetes,
  },
  {
    title: "Datenbank",
    body: "Schema-Layout, Migrationen bei Upgrades und Managed-PostgreSQL anbinden.",
    href: docs.database,
  },
  {
    title: "Object Storage",
    body: "Optionale Buckets für Scan-Logs und hochgeladene Artefakte.",
    href: docs.storage,
  },
  {
    title: "Upgrades & Versionierung",
    body: "Wie Image-Tags der Chart-appVersion folgen, und was ein Versionsbump bedeutet.",
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

export default function GetPageDe() {
  const editionsHref = `${withLocalePrefix("de", routes.editions)}/`;
  const sourcesHref = `${withLocalePrefix("de", routes.sources)}/`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        title={
          <>
            Heute Nacht
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              läuft es.
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
                <a href="#docker">Docker</a>
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
              v{softwareVersion} · kostenlos · keine Anmeldung
            </span>
          </div>
        }
      />

      {/* ── Docker ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="docker-title" id="docker">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="docker-title"
              marker="Option 01 · Docker"
              title="Auf Ihrer Maschine betreiben"
              lede="Ein Image, identisch auf macOS, Windows und Linux. Datenbank und Scan-Worker sind schon drin — nichts zu provisionieren, nichts anzubinden."
            />

            <div className="mx-auto w-full max-w-3xl">
              <DockerRunBlock
                label="Starten"
                lines={dockerRunLines(dockerImageTag, getDockerNotes("de"))}
                copy={deTranslations.docker}
              />
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Dann{" "}
                <span className="font-mono text-foreground">
                  localhost:3000
                </span>{" "}
                öffnen. Braucht Docker und 4 GB Memory. Diese Volumes tragen
                Ihre Arbeit über Upgrades — der{" "}
                <DocsLink href={docs.docker}>Docker-Guide</DocsLink> deckt die
                Umgebungsvariablen, externe Datenbanken und Object Storage ab.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {dockerIncludes.map((item, index) => (
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
              marker="Erster Lauf"
              tone="signal"
              illustration="check-list"
              title="In vier Schritten zum ersten Befund"
              lede="Nichts hier braucht eine Konfigurationsdatei. Jeder Schritt passiert in der App, und jeder hat eine Seite in der Doku, wenn Sie ins Detail wollen."
              action={
                <DocsLink href={docs.inTheApp} tone="signal">
                  App-Tour
                </DocsLink>
              }
            />

            <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {firstRunSteps.map((item, index) => (
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
              title="Oder auf Ihrem Cluster skalieren"
              lede="Derselbe Open-Source-Kern als Helm-Chart — Web, API, Worker und ephemere Scan-Jobs, die unter Last auffächern und zwischen den Läufen auf null skalieren."
              action={
                <div className="flex flex-wrap gap-2">
                  <DocsLink href={docs.kubernetes}>
                    Vollständige Deployment-Anleitung
                  </DocsLink>
                  <DocsLink
                    href={`${repoUrl}/blob/main/helm/classifyre/README.md`}
                  >
                    Chart-README auf GitHub
                  </DocsLink>
                </div>
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
                      Helm, OCI-nativ
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-primary-foreground/60">
                      Kein Repo-Add-Schritt
                    </p>
                  </div>
                </div>

                <CommandBlock
                  label="Vor dem Installieren prüfen"
                  lines={[`helm show chart ${helmChartRef}`]}
                />
                <CommandBlock
                  label="Installieren"
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
                      Voraussetzungen
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
                      Images · Multi-Arch
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
                      Doku lesen →
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
              marker="Unschlüssig"
              illustration="settings"
              title="Entscheiden Sie danach, wo die Daten bleiben müssen"
              lede="Beide Runtimes tragen dieselben Features, und ein Namespace-Export trägt Ihre Arbeit von einer zur anderen — an diese Entscheidung sind Sie also nicht gekettet."
            />

            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  head: "Docker wählen, wenn",
                  tone: "accent" as const,
                  points: [
                    "Sie evaluieren oder allein ermitteln.",
                    "Der Korpus liegt auf Ihrer Maschine oder ist von dort erreichbar.",
                    "Nichts darf den Laptop verlassen.",
                    "Sie wollen in zehn Minuten scannen.",
                  ],
                },
                {
                  head: "Kubernetes wählen, wenn",
                  tone: "plain" as const,
                  points: [
                    "Ein Team teilt sich die Instanz, aufgeteilt in Workspaces.",
                    "Scans sollen nach Zeitplan laufen, unbeaufsichtigt.",
                    "Der Bestand ist groß genug, um auffächernde Worker zu brauchen.",
                    "Es muss in Ihrem bestehenden Cluster und Netz sitzen.",
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
                Fragen Sie sich, was der Enterprise-Layer auf beide Runtimes
                noch drauflegt? Es sind SSO, Rollen und Autorisierung pro
                Workspace — keine Features, die dem Open-Source-Kern
                vorenthalten werden.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={editionsHref}>Open Source vs. Enterprise</a>
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
              Richten Sie es auf etwas{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Echtes.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Der schnellste ehrliche Test ist ein System, das Sie bereits
              betreiben. Installieren Sie es, binden Sie eine Quelle an und
              sehen Sie, was der Ermittler zutage fördert.
            </p>
            <div className="flex w-full flex-wrap items-start justify-center gap-3">
              <div className="w-full max-w-2xl">
                <DockerRunBlock
                  tone="dark"
                  lines={dockerRunLines(dockerImageTag, getDockerNotes("de"))}
                  copy={deTranslations.docker}
                />
              </div>
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
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white/50">
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Source auf GitHub
              </a>
              <a
                href={sourcesHref}
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Unterstützte Quellen
              </a>
              <a
                href={docs.root}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                Dokumentation
              </a>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
