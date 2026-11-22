import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { AboutPillars } from "@/components/about-pillars";
import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  contactEmail,
  docs,
  repoUrl,
  routes,
  showcaseUrlFor,
} from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../../landing.css";

export const metadata: Metadata = {
  title: { absolute: "Über Classifyre — Open-Source Data Governance" },
  description:
    "Classifyre ist eine Open-Source Data-Governance-Plattform aus Österreich, entwickelt nach europäischen Datenschutz- und Sicherheitsstandards und weltweit im Einsatz.",
  alternates: {
    canonical: "/de/made-in-europe/",
    languages: {
      en: "/made-in-europe/",
      de: "/de/made-in-europe/",
      "x-default": "/made-in-europe/",
    },
  },
  openGraph: {
    title: "Über Classifyre — Entwickelt in Österreich, weltweit im Einsatz",
    description:
      "100 % Apache-2.0 Open-Source Data Governance aus Österreich nach europäischen Standards – weltweit selbst betrieben auf eigener Infrastruktur.",
    type: "website",
    locale: "de_AT",
  },
};

function SubtleAustrianMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 w-5 shrink-0 flex-col overflow-hidden border border-white/25"
    >
      <span className="h-1/3 w-full bg-[#ed2939]" />
      <span className="h-1/3 w-full bg-white" />
      <span className="h-1/3 w-full bg-[#ed2939]" />
    </span>
  );
}

const principles: readonly {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}[] = [
  {
    marker: "Integration zuerst",
    title: "Passt in Ihre bestehende Architektur",
    body: "Behalten Sie Ihre ETL-Pipelines, Datenbanken, Iceberg- und Delta-Lakehouses, Ihren Verzeichnisdienst und Ihre BI-Werkzeuge. Classifyre integriert sich direkt darüber, statt eine kostspielige Migration zu erzwingen.",
    href: "/de/sources/",
    hrefLabel: "Unterstützte Quellen ansehen",
  },
  {
    marker: "Datensouveränität",
    title: "Alles bleibt auf Ihrer Infrastruktur",
    body: "Classifyre ist selbst betriebene Software, kein mandantenübergreifender SaaS-Upload. Betreiben Sie es lokal mit Docker oder produktiv auf Kubernetes und OpenShift – On-Premises, in Ihrer Private Cloud oder auf AWS, Azure und GCP.",
    href: docs.deployment,
    hrefLabel: "Deployment-Architektur",
  },
  {
    marker: "Europäische Standards",
    title: "Datenschutz und Sicherheit als Standard",
    body: "Entwickelt in Österreich im Umfeld von DSGVO, NIS2, DORA und EU AI Act. Personenbezogene Spalten sind standardmäßig maskiert, Admins erhalten nicht automatisch Klartext, jeder Zugriff wird protokolliert und die Wahl der KI-Modelle bleibt bei Ihnen.",
    href: docs.aiProviders,
    hrefLabel: "KI- & Modellkonfiguration",
  },
  {
    marker: "Offen konzipiert",
    title: "100 % Apache-2.0, ohne gesperrte Stufen",
    body: "Prüfen Sie jede Zeile Code, verifizieren Sie Maskierung und Zugriffssteuerung und betreiben Sie die gesamte Plattform ohne Nutzerlizenzen selbst. Wenn Sie individuelle Anpassungen benötigen, arbeiten Sie direkt mit unserem Engineering-Team.",
    href: "/de/support/",
    hrefLabel: "Support & Anpassung",
  },
];

const openSourceFacts: readonly {
  label: string;
  value: string;
  detail: string;
}[] = [
  {
    label: "Lizenz",
    value: "Apache-2.0",
    detail:
      "Permissive Open-Source-Lizenz mit Patentklausel. Prüfen, erweitern und kommerziell betreiben – ohne Herstellerbindung.",
  },
  {
    label: "Vollständiger Kern",
    value: "Alle Funktionen enthalten",
    detail:
      "SSO, Rollen, Zeilenfilter, dynamische Maskierung, SQL/BI-Gateway, geteilte Datenprodukte, Audit-Log, Docker-Image sowie Kubernetes- & OpenShift-Helm-Chart.",
  },
  {
    label: "Transparenz",
    value: "Offen entwickelt",
    detail:
      "Architektur, Konnektoren, Releases und Sicherheits-Updates sind öffentlich auf GitHub einsehbar – maximale Nachvollziehbarkeit vor dem Einsatz.",
  },
];

const coordinates: readonly { label: string; value: string; accent?: boolean }[] = [
  { label: "Entwicklung", value: "Österreich, Europäische Union", accent: true },
  { label: "Einsatzgebiet", value: "Europa, Nordamerika & weltweit" },
  { label: "Lizenz", value: "Apache-2.0 · 100 % Open Source" },
  { label: "Betrieb", value: "Docker · Kubernetes · OpenShift" },
];

export default function MadeInEuropePageDe() {
  const getHref = `${withLocalePrefix("de", routes.get)}/`;
  const supportHref = `${withLocalePrefix("de", routes.support)}/`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Über Classifyre"
        title={
          <>
            Entwickelt in Österreich.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Weltweit im Einsatz.
            </span>
          </>
        }
        lede={
          <>
            Classifyre ist eine Open-Source Data-Governance-Plattform, entwickelt
            in Österreich nach europäischen Datenschutz- und Sicherheitsstandards
            – für Organisationen in Österreich, der EU, Nordamerika und weltweit.
            Zentrale Data-Governance-Infrastruktur sollte transparent, selbst
            betreibbar und frei von proprietärer Herstellerbindung sein.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={supportHref}>Mit unserem Team sprechen</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={repoUrl} target="_blank" rel="noreferrer">
                Quellcode auf GitHub
              </a>
            </Button>
          </>
        }
        aside={
          <div className="border-2 border-white/20 bg-white/[0.04] p-6">
            <dl className="divide-y divide-white/15">
              {coordinates.map((item) => (
                <div key={item.label} className="py-3.5 first:pt-0 last:pb-0">
                  <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {item.label}
                  </dt>
                  <dd className="mt-1 flex items-center gap-2.5 font-sans text-base font-semibold text-white">
                    {item.accent ? <SubtleAustrianMark /> : null}
                    <span>{item.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        }
      />

      {/* ── Durchgängige Funktionen ───────────────────────────────────────── */}
      <AboutPillars locale="de" />

      {/* ── Engineering-Prinzipien ────────────────────────────────────────── */}
      <section aria-labelledby="principles-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="principles-title"
              marker="Wie wir bauen"
              title="Praxisnahes Engineering, klare Grenzen"
              lede="Gebaut für Organisationen, die konsequente Data Governance brauchen, ohne die Kontrolle über ihre Datenlandschaft an einen proprietären Anbieter abzugeben."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              {principles.map((item, index) => {
                const external = item.href?.startsWith("http");
                return (
                  <Reveal key={item.marker} delayMs={index * 70} className="h-full">
                    <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                      <Marker label={item.marker} />
                      <h3 className="font-sans text-lg font-bold leading-snug text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                      {item.href && item.hrefLabel ? (
                        <div className="mt-auto pt-2">
                          <a
                            href={item.href}
                            {...(external ? { target: "_blank", rel: "noreferrer" } : null)}
                            className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-accent-foreground hover:underline dark:hover:text-accent"
                          >
                            {item.hrefLabel} →
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </Reveal>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-border bg-muted/30 p-5 sm:p-6">
              <div className="max-w-3xl space-y-1.5">
                <Marker label="Hinweis zur Compliance" />
                <p className="pt-1 text-sm leading-6 text-muted-foreground">
                  Keine Software allein macht eine Organisation rechtskonform.
                  Classifyre liefert den technischen Unterbau – Gruppenrechte,
                  Zeilenfilter, Spaltenmaskierung und nachvollziehbare
                  Zugriffsprotokolle –, der DSGVO, NIS2, DORA und interne
                  Governance-Vorgaben wirksam unterstützt.
                </p>
              </div>
              <DocsLink href={docs.deployment}>Architektur-Doku</DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Open-Source-Versprechen ───────────────────────────────────────── */}
      <section aria-labelledby="open-source-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto max-w-7xl space-y-8 text-white">
            <div className="max-w-2xl space-y-3">
              <Marker label="Open Source" />
              <h2
                id="open-source-title"
                className="font-hero text-[clamp(2.2rem,5vw,3.8rem)] uppercase leading-[0.9] tracking-[0.01em] text-white"
              >
                Prüfen Sie die Qualität selbst.
              </h2>
              <p className="text-base leading-7 text-white/70">
                Evaluieren Sie Classifyre direkt anhand des Quellcodes, testen Sie
                es auf Ihren eigenen Datenbanken und betreiben Sie es in Ihrer
                Umgebung – ohne Funktionssperren.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {openSourceFacts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex h-full flex-col gap-2 border-2 border-white/20 bg-white/[0.04] p-5"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    {fact.label}
                  </span>
                  <p className="font-sans text-lg font-bold text-white">
                    {fact.value}
                  </p>
                  <p className="text-sm leading-6 text-white/70">{fact.detail}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-white/15 pt-6">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={getHref}>Installation & Betrieb</a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </Button>
              <a
                href={showcaseUrlFor("de")}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/60 underline-offset-4 hover:text-accent hover:underline"
              >
                Live-Demo ansehen →
              </a>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
