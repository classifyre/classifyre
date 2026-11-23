import type { Locale } from "@/lib/locale";
import { docs } from "@/lib/site";
import { Marker, SectionHead, SectionShell } from "@/components/page-kit";
import { Reveal } from "@/components/reveal";

/**
 * End-to-end platform pillars on the About page — aligned with the homepage
 * governance flow (Integrate & Detect → Group Access → Multi-Level Masking →
 * SQL & BI → Data Requests & Products → Audit & Quality).
 */

type Pillar = { marker: string; title: string; body: string; href: string; hrefLabel: string };

const COPY: Record<
  Locale,
  { marker: string; title: string; lede: string; pillars: readonly Pillar[] }
> = {
  en: {
    marker: "What Classifyre does",
    title: "End-to-end data governance on your own infrastructure",
    lede: "Six connected capabilities that integrate with the systems and tools you already operate.",
    pillars: [
      {
        marker: "01 · Connect & detect",
        title: "40+ sources and flexible detectors",
        body: "Connect databases, Iceberg, Delta, Parquet, object storage, and collaboration platforms — or plug in custom sources. Detect personal data, secrets, and business-specific signals with regex, Python rules, local CPU AI extraction models, or private LLMs.",
        href: docs.detectors,
        hrefLabel: "Explore detectors",
      },
      {
        marker: "02 · Group access",
        title: "Permissions driven by your directory",
        body: "Integrate Entra ID, Active Directory, Okta, or any OIDC/SAML directory. Grants apply to groups with optional expiration dates, owner-approved access requests, and row-level filters per department or region.",
        href: docs.whoMayQuery,
        hrefLabel: "How access control works",
      },
      {
        marker: "03 · Multi-level masking",
        title: "Column and row protection per group",
        body: "Mask sensitive columns as redacted, last-four, deterministic hashed pseudonymisation, empty, or hidden — enforced inside the query engine on both source tables and shared datasets. Admins do not get unmasked values by default.",
        href: docs.masking,
        hrefLabel: "How masking works",
      },
      {
        marker: "04 · SQL & BI access",
        title: "Power BI, Excel, Tableau, and ODBC",
        body: "Expose governed data over a standard PostgreSQL-compatible endpoint with personal, expiring TLS connections. Analysts query live in SQL, Power BI, Excel, or via MCP AI agents without shared database passwords.",
        href: docs.sqlConnections,
        hrefLabel: "SQL & BI connections",
      },
      {
        marker: "05 · Requests & data products",
        title: "Plain-language requests and Delta shares",
        body: "Business users request combined datasets in natural language or via structured workflows. Owners review and publish governed live or Delta shared data products that automatically inherit source masking as a strict floor.",
        href: docs.sharedDatasets,
        hrefLabel: "Shared datasets",
      },
      {
        marker: "06 · Audit & quality",
        title: "Complete read log and data contracts",
        body: "Every read, export, permission change, and approval is logged with user and tool. Named owners, scheduled data quality checks, and open data contracts make compliance reviews straightforward.",
        href: docs.governance,
        hrefLabel: "Governance & audit",
      },
    ],
  },
  de: {
    marker: "Was Classifyre leistet",
    title: "Durchgängige Data Governance auf Ihrer eigenen Infrastruktur",
    lede: "Sechs nahtlos verbundene Bausteine, die sich in Ihre bestehenden Systeme und Werkzeuge einfügen.",
    pillars: [
      {
        marker: "01 · Verbinden & erkennen",
        title: "40+ Quellen und flexible Detektoren",
        body: "Verbinden Sie Datenbanken, Iceberg, Delta, Parquet, Object Storage und Fachsysteme – oder eigene Konnektoren. Erkennen Sie PII, Secrets und Geschäftsregeln per Regex, Python, lokalen CPU-KI-Modellen oder privaten LLMs.",
        href: docs.detectors,
        hrefLabel: "Detektoren ansehen",
      },
      {
        marker: "02 · Gruppenrechte",
        title: "Berechtigungen direkt aus Ihrem Verzeichnis",
        body: "Integrieren Sie Entra ID, Active Directory, Okta oder OIDC/SAML. Freigaben gelten für Gruppen mit optionalem Ablaufdatum, Freigabe durch Data Owner und Zeilenfiltern je Abteilung oder Region.",
        href: docs.whoMayQuery,
        hrefLabel: "Zugriffssteuerung ansehen",
      },
      {
        marker: "03 · Mehrstufige Maskierung",
        title: "Spalten- und Zeilenschutz je Gruppe",
        body: "Maskieren Sie sensible Spalten geschwärzt, mit den letzten vier Stellen, als deterministisch gehashte Pseudonymisierung, leer oder verborgen – direkt in der Abfrage auf Quelltabellen und Datenprodukten.",
        href: docs.masking,
        hrefLabel: "Maskierung verstehen",
      },
      {
        marker: "04 · SQL & BI-Zugriff",
        title: "Power BI, Excel, Tableau und ODBC",
        body: "Stellen Sie verwaltete Daten über einen PostgreSQL-kompatiblen Endpunkt mit persönlichen, befristeten TLS-Verbindungen bereit – für SQL, Power BI, Excel und KI-Agenten via MCP ohne geteilte Passwörter.",
        href: docs.sqlConnections,
        hrefLabel: "SQL- & BI-Verbindungen",
      },
      {
        marker: "05 · Anfragen & Datenprodukte",
        title: "Datenanfragen und Delta-Datenprodukte",
        body: "Fachbereiche fordern kombinierte Datensätze in Alltagssprache an. Data Owner prüfen und veröffentlichen verwaltete Live- oder Delta-Datenprodukte, die alle Quellmasken automatisch als Untergrenze erben.",
        href: docs.sharedDatasets,
        hrefLabel: "Geteilte Datasets",
      },
      {
        marker: "06 · Audit & Qualität",
        title: "Lückenloses Protokoll und Datenverträge",
        body: "Jeder Lesezugriff, Export, jede Freigabe und Änderung wird mit Person und Werkzeug protokolliert. Klare Verantwortlichkeiten, geplante Qualitätsprüfungen und offene Datenverträge erleichtern jedes Audit.",
        href: docs.governance,
        hrefLabel: "Governance & Audit",
      },
    ],
  },
};

export function AboutPillars({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  return (
    <section aria-labelledby="what-title">
      <SectionShell tone="plain">
        <div className="space-y-8">
          <SectionHead
            id="what-title"
            marker={copy.marker}
            title={copy.title}
            lede={copy.lede}
          />
          <ol className="grid gap-4 lg:grid-cols-2">
            {copy.pillars.map((pillar, index) => (
              <Reveal key={pillar.marker} as="li" delayMs={index * 60} className="h-full">
                <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                  <Marker label={pillar.marker} />
                  <h3 className="font-sans text-lg font-bold leading-snug text-foreground">
                    {pillar.title}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">{pillar.body}</p>
                  <div className="mt-auto pt-2">
                    <a
                      href={pillar.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-accent-foreground hover:underline dark:hover:text-accent"
                    >
                      {pillar.hrefLabel} →
                    </a>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </SectionShell>
    </section>
  );
}
