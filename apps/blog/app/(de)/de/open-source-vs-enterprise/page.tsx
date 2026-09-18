import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { Illustration } from "@/components/illustration";
import {
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import {
  docs,
  enterpriseContactEmail,
  repoUrl,
  routes,
  showcaseUrlFor,
} from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Open Source vs. Enterprise",
  description:
    "Ein schlichter Vergleich von Classifyres Open-Source-Kern und dem Enterprise-Layer. Jede Detektions-, Ermittlungs- und Deployment-Funktion ist Open Source; Enterprise legt SSO, Rollen, Autorisierung pro Workspace, abgestimmte Modelle und Support mit SLA drauf.",
  alternates: {
    canonical: "/de/open-source-vs-enterprise/",
    languages: {
      en: "/open-source-vs-enterprise/",
      de: "/de/open-source-vs-enterprise/",
      "x-default": "/open-source-vs-enterprise/",
    },
  },
  openGraph: {
    title: "Classifyre — Open Source vs. Enterprise",
    description:
      "Detektion, Ermittlungen, Autopilot und beide Runtimes sind Open Source. Enterprise legt die Governance-Schicht und unsere Engineers drauf.",
    type: "website",
  },
};

/**
 * `oss` / `ent` are either a boolean (rendered as a tick or a dash) or a
 * short string when the two editions differ by degree rather than presence.
 * Nothing in the open-source column is a teaser for a paid feature — that is
 * the entire point of the page, so the data is written to make it obvious.
 */
type Row = {
  capability: string;
  detail?: string;
  oss: boolean | string;
  ent: boolean | string;
};

type RowGroup = {
  group: string;
  summary: string;
  rows: Row[];
};

const COMPARISON: readonly RowGroup[] = [
  {
    group: "Detektion",
    summary: "Identisch. Die Engine ist das Open-Source-Projekt.",
    rows: [
      {
        capability: "Jeder Quellen-Konnektor",
        detail: "Datenbanken, Lakehouses, Kollaborationstools, Storage, Streams",
        oss: true,
        ent: true,
      },
      {
        capability: "Eingebaute Detektor-Packs",
        detail: "PII, Secrets, Code-Security, Threats, Content-Qualität",
        oss: true,
        ent: true,
      },
      {
        capability: "Eigene Detektoren",
        detail: "Regex, Entitäts-Klassifizierung, Hugging-Face-Modelle, jedes LLM",
        oss: true,
        ent: "Mit Ihnen gebaut",
      },
      {
        capability: "Semantisches Ranking",
        detail: "Wichtigkeit 0–1 mit aufgeschriebenen Gründen, nicht nur Severity",
        oss: true,
        ent: "Auf Ihren Korpus kalibriert",
      },
      {
        capability: "Detektion abgestimmt auf Ihre Terminologie",
        detail: "Modelle, trainiert, damit ein Begriff bedeutet, was er in Ihrer Firma bedeutet",
        oss: false,
        ent: true,
      },
      {
        capability: "Mehrsprachiges Detektions-Tuning",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "Ermittlung",
    summary: "Identisch. Fälle sind das Produkt, in beiden Editionen.",
    rows: [
      {
        capability: "Befunde, Anfragen und Fingerprints",
        oss: true,
        ent: true,
      },
      {
        capability: "Fälle, Hypothesen und Beweisspuren",
        oss: true,
        ent: true,
      },
      {
        capability: "Harness-AI-Autopilot",
        detail: "Fünf Agenten bearbeiten die Ermittlung zwischen den Scans",
        oss: true,
        ent: "Auf Ihre Workflows abgestimmt",
      },
      {
        capability: "In-App-Assistent und MCP-Server",
        detail: "Das ganze Produkt aus Ihrem eigenen KI-Client steuern",
        oss: true,
        ent: true,
      },
      { capability: "Benachrichtigungen und Datenexport", oss: true, ent: true },
    ],
  },
  {
    group: "Deployment",
    summary: "Identisch. Keine Runtime wird zurückgehalten.",
    rows: [
      {
        capability: "All-in-one-Docker-Image",
        detail: "macOS, Windows, Linux — PostgreSQL drinnen",
        oss: true,
        ent: true,
      },
      {
        capability: "Helm-Chart auf Kubernetes",
        detail: "Skaliert so weit, wie der Bestand verlangt",
        oss: true,
        ent: true,
      },
      {
        capability: "Workspace-Isolierung",
        detail: "Eigenes Schema, eigene Beweise, eigenes KI-Memory und eigener Endpunkt pro Workspace",
        oss: true,
        ent: true,
      },
      {
        capability: "OpenShift",
        detail: "Mit Upgrade-Hilfe unserer Engineers",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "Governance",
    summary: "Der echte Unterschied — das Schloss am Schrank.",
    rows: [
      { capability: "Single Sign-on (SSO)", oss: false, ent: true },
      { capability: "Rollen und Berechtigungen", oss: false, ent: true },
      {
        capability: "Autorisierung pro Workspace",
        detail: "Ein Auditor öffnet den Audit-Workspace und sonst nichts",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "Menschen",
    summary: "Was Sie außer Software bekommen.",
    rows: [
      {
        capability: "Support",
        oss: "GitHub-Issues",
        ent: "Mit SLA, benannte Engineers",
      },
      {
        capability: "Onboarding",
        oss: "Doku und die Showcase",
        ent: "Begleiteter Pilot, Architektur-Review",
      },
      {
        capability: "Einfluss auf die Roadmap",
        oss: "Offene Issues und PRs",
        ent: "Direkt, an den Daten Ihrer Branche",
      },
      { capability: "Preis", oss: "Kostenlos, für immer", ent: "Sprechen Sie mit uns" },
    ],
  },
];

function Cell({
  value,
  emphasis,
}: {
  value: boolean | string;
  emphasis: boolean;
}) {
  if (typeof value === "string") {
    return (
      <span
        className={cn(
          "font-mono text-[11px] uppercase leading-5 tracking-[0.08em]",
          emphasis
            ? "text-accent-foreground/80 dark:text-accent"
            : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    );
  }

  if (value) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center border-2 border-accent bg-accent font-mono text-[13px] font-black text-black"
        role="img"
        aria-label="Enthalten"
      >
        ✓
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center border-2 border-border font-mono text-[13px] text-muted-foreground"
      role="img"
      aria-label="Nicht enthalten"
    >
      –
    </span>
  );
}

/** One capability as a card — the mobile shape of the comparison table. */
function RowCard({ row }: { row: Row }) {
  return (
    <div className="border-2 border-border bg-background p-4">
      <p className="font-serif text-sm font-black uppercase leading-tight tracking-[0.04em]">
        {row.capability}
      </p>
      {row.detail ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {row.detail}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-px bg-border">
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Open Source
          </dt>
          <dd>
            <Cell value={row.oss} emphasis={false} />
          </dd>
        </div>
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-accent-foreground/70 dark:text-accent">
            Enterprise
          </dt>
          <dd>
            <Cell value={row.ent} emphasis />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function EditionCard({
  eyebrow,
  title,
  body,
  points,
  action,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 border-2 bg-background p-6 sm:p-8",
        featured
          ? "border-accent shadow-[6px_6px_0_var(--color-accent)]"
          : "border-border shadow-[6px_6px_0_var(--color-border)]",
      )}
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {eyebrow}
      </span>
      <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
        {title}
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      <ul className="flex flex-col gap-2">
        {points.map((point) => (
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
      <div className="mt-auto pt-2">{action}</div>
    </div>
  );
}

export default function EditionsPageDe() {
  const getHref = `${withLocalePrefix("de", routes.get)}/`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">

      {/* ── The two editions ─────────────────────────────────────────────── */}
      <section aria-labelledby="editions-title">
        <SectionShell tone="plain" fullWidth>
          <div className="space-y-8">
            <SectionHead
              id="editions-title"
              marker="Auf einen Blick"
              title="Gleiche Engine. Anderer Raum."
              lede="Der Open-Source-Kern ist das ganze Produkt, kein Trichter in ein Bezahlprodukt. Was Enterprise verkauft, sind Governance, Tuning und Menschen — die Dinge, die eine große Organisation wirklich nicht selbst bedienen kann."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <EditionCard
                eyebrow="Open Source · für immer kostenlos"
                title="Kern"
                body="Alles, was detektiert, ermittelt und deployt. Auf einem Laptop oder clusterweit betreiben, so lange Sie wollen, ohne Seat-Count und ohne Ablauf."
                points={[
                  "Jeder Konnektor, jedes Detektor-Pack und jede Custom-Detektor-Stufe",
                  "Anfragen, Fingerprints, Fälle und der Harness-AI-Autopilot",
                  "Docker-Image und Helm-Chart, beide voll ausgestattet",
                  "Workspace-Isolierung steckt im Kern und ist immer an",
                ]}
                action={
                  <div className="flex flex-wrap gap-3">
                    <Button
                      asChild
                      className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                    >
                      <a href={getHref}>Holen</a>
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      className="border-2 border-border"
                    >
                      <a href={repoUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </Button>
                  </div>
                }
              />
              <EditionCard
                featured
                eyebrow="Enterprise · eine Partnerschaft"
                title="Gesteuert"
                body="Der Kern plus das Schloss am Schrank, und Engineers, die Ihre Domäne lernen. Unsere Leute arbeiten mit Ihrem Team ab dem ersten Piloten, statt einen Lizenzschlüssel zu überreichen."
                points={[
                  "SSO, Rollen und Autorisierung pro Workspace",
                  "Modelle, abgestimmt auf Ihre Terminologie und Sprachen",
                  "Detektoren und Quellen, gebaut für die Daten Ihrer Branche",
                  "Architektur-Reviews, OpenShift, Support mit SLA",
                ]}
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      asChild
                      className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                    >
                      <a href={`mailto:${enterpriseContactEmail}`}>
                        Gespräch beginnen
                      </a>
                    </Button>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {enterpriseContactEmail}
                    </span>
                  </div>
                }
              />
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── The table ────────────────────────────────────────────────────── */}
      <section aria-labelledby="comparison-title" id="comparison">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="comparison-title"
              marker="Zeile für Zeile"
              title="Der gesamte Vergleich"
              lede="Vier der fünf Gruppen unten sind zwischen den Editionen identisch."
            />

            {/* Desktop: one continuous table. Below lg the same data renders
                as cards, because a three-column table with prose in it is
                unreadable on a phone no matter how it is scrolled. */}
            <div className="hidden overflow-hidden border-2 border-border lg:block">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Feature-Vergleich zwischen dem Classifyre-Open-Source-Kern
                  und der Enterprise-Edition
                </caption>
                <thead>
                  <tr className="bg-foreground text-primary-foreground">
                    <th
                      scope="col"
                      className="w-1/2 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                    >
                      Funktion
                    </th>
                    <th
                      scope="col"
                      className="w-1/4 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                    >
                      Open Source
                    </th>
                    {/* A lime block rather than lime text: the header bar is
                        painted with bg-foreground, which flips with the theme,
                        and accent text is unreadable on its light side. */}
                    <th
                      scope="col"
                      className="w-1/4 border-l-2 border-accent bg-accent px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black"
                    >
                      Enterprise
                    </th>
                  </tr>
                </thead>
                {COMPARISON.map((section) => (
                  <tbody key={section.group}>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <th
                        scope="colgroup"
                        colSpan={3}
                        className="px-5 py-3 text-left"
                      >
                        <span className="font-serif text-base font-black uppercase tracking-[0.06em]">
                          {section.group}
                        </span>
                        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {section.summary}
                        </span>
                      </th>
                    </tr>
                    {section.rows.map((row) => (
                      <tr
                        key={row.capability}
                        className="border-t-2 border-border align-top"
                      >
                        <th
                          scope="row"
                          className="px-5 py-4 text-left font-normal"
                        >
                          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.08em]">
                            {row.capability}
                          </span>
                          {row.detail ? (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                              {row.detail}
                            </span>
                          ) : null}
                        </th>
                        <td className="px-5 py-4">
                          <Cell value={row.oss} emphasis={false} />
                        </td>
                        <td className="border-l-2 border-accent bg-accent/5 px-5 py-4">
                          <Cell value={row.ent} emphasis />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            {/* Mobile / tablet */}
            <div className="space-y-6 lg:hidden">
              {COMPARISON.map((section) => (
                <div key={section.group} className="space-y-3">
                  <div className="border-l-2 border-accent pl-4">
                    <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em]">
                      {section.group}
                    </h3>
                    <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.12em] text-muted-foreground">
                      {section.summary}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.rows.map((row) => (
                      <RowCard key={row.capability} row={row} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-2 border-border bg-background p-5">
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Workspace-Isolierung lebt im Open-Source-Kern und ist immer
                an — ein Workspace hat eigenes Datenbank-Schema, eigene
                Beweise, eigenes KI-Memory und eigenen Endpunkt. Enterprise
                legt nicht die Mauer dazu; es legt die{" "}
                <em>Autorisierung</em> dazu, die entscheidet, wer welche
                Schublade öffnen darf.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={docs.workspaces} target="_blank" rel="noreferrer">
                  So funktionieren Workspaces
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="editions-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <h2
              id="editions-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Gratis starten.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Später anrufen.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Fast alle starten mit dem Open-Source-Kern und bleiben dort.
              Das Gespräch lohnt, wenn SSO, Rollen und ein abgestimmtes Modell
              wichtiger werden als der Scan selbst.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={getHref}>
                  Den kostenlosen Kern holen
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  Über Enterprise sprechen
                </a>
              </Button>
            </div>
            <a
              href={showcaseUrlFor("de")}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
            >
              Oder erst in der Live-Showcase stöbern
            </a>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
