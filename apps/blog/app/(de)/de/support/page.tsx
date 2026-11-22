import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { FaqList } from "@/components/landing/faq";
import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  JsonLdScripts,
  generateBreadcrumbSchema,
  generateContactPageSchema,
  generateFaqSchema,
  siteOrigin,
} from "@/lib/seo";
import { contactEmail, docs, repoUrl, showcaseUrlFor } from "@/lib/site";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Support & individuelle Anpassung",
  description:
    "Self-Service-Ressourcen, Community-Kanäle und direkte Engineering-Zusammenarbeit für Classifyre. 100 % Open Source (Apache-2.0) mit individuell vereinbarter Anpassung für IAM, eigene Quellen, Delta-Datenprodukte und Detektoren.",
  alternates: {
    canonical: "/de/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre Support & individuelle Einführung",
    description:
      "Dokumentation, GitHub-Community und direkte Engineering-Unterstützung mit individuell vereinbartem Umfang.",
    type: "website",
  },
};

const selfService: readonly {
  marker: string;
  title: string;
  body: string;
  href: string;
  label: string;
  external?: boolean;
}[] = [
  {
    marker: "Dokumentation",
    title: "Setup, Konnektoren & Governance-Guides",
    body: "Schritt-für-Schritt-Anleitungen für Docker, Kubernetes & OpenShift Helm-Deployments, Verzeichnis-SSO, Maskierung, SQL-Verbindungen und eigene Detektoren.",
    href: docs.root,
    label: "Dokumentation öffnen",
    external: true,
  },
  {
    marker: "Community & Bugs",
    title: "GitHub Issues & Pull Requests",
    body: "Fehler melden, neue Konnektoren oder Funktionen vorschlagen oder Releases direkt im öffentlichen Apache-2.0-Repository verfolgen.",
    href: `${repoUrl}/issues`,
    label: "GitHub Issues öffnen",
    external: true,
  },
  {
    marker: "Live-Umgebung",
    title: "Live-Showcase direkt ansehen",
    body: "Prüfen Sie echte Workspace-Ansichten, Klassifizierungsbefunde, Maskierungsverhalten und Governance-Tabs ganz ohne lokale Installation.",
    href: showcaseUrlFor("de"),
    label: "Live-Demo starten",
    external: true,
  },
  {
    marker: "Releases & Sicherheit",
    title: "Release Notes & Sicherheitsmeldungen",
    body: "Verfolgen Sie Versionsänderungen und Upgrade-Hinweise – oder melden Sie Sicherheitsthemen vertraulich direkt an unser Engineering-Team.",
    href: "/de/release-notes/",
    label: "Release Notes ansehen",
  },
];

const tailoringAreas: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "IAM & Organisation",
    title: "Verzeichnisdienst, Sicherheit & Organisationsdesign",
    body: "Anbindung an komplexe Active-Directory-, Entra-ID-, Okta- oder eigene IAM-Hierarchien, Mandantenstrukturen sowie interne Sicherheits- und Datenschutzrichtlinien.",
  },
  {
    marker: "Eigene Quellen",
    title: "Konnektoren für Fach- und Bestandssysteme",
    body: "Entwicklung, Absicherung und Pflege von Konnektoren für branchenspezifische Datenbanken, interne APIs oder gewachsene Systeme außerhalb des Standardkatalogs.",
  },
  {
    marker: "Datenprodukte",
    title: "Delta-Datenprodukte & Freigabeprozesse",
    body: "Aufbau verwalteter geteilter Datasets, Delta-Sharing-Strecken sowie fachlicher Datenanfragen in Alltagssprache mit Owner-Freigabe und vererbter Maskierung.",
  },
  {
    marker: "Detektoren & KI",
    title: "Geschäftsspezifische Detektoren & Modelle",
    body: "Umsetzung eigener Regex- oder Python-Regeln, lokaler CPU-KI-Modelle (wie GLiNER2) sowie privater LLM-Klassifikatoren direkt in Ihrer Umgebung.",
  },
  {
    marker: "Infrastruktur",
    title: "Kubernetes, OpenShift & Air-Gapped-Betrieb",
    body: "Architektur-Review und Produktivbetrieb auf Kubernetes, OpenShift, On-Premises-Clustern oder Ihrer Cloud – inklusive TLS, Dimensionierung und Tuning.",
  },
  {
    marker: "Architektur-Review",
    title: "Prüfung von Sicherheit, Maskierung & Audit",
    body: "Gemeinsame Verifikation von Zeilenfiltern, Spaltenmasken, Power-BI-/Excel-/ODBC-Anbindung und Audit-Protokollierung mit Ihren Security- und Datenschutzteams.",
  },
];

const collaborationSteps: readonly { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Ausgangslage & Ziele teilen",
    body: "Schildern Sie uns Ihre Datenquellen, Ihr IAM, Ihre Ziel-Infrastruktur und Ihre Governance-Ziele. Sie sprechen direkt mit den Entwicklern von Classifyre.",
  },
  {
    step: "02",
    title: "Umfang individuell vereinbaren",
    body: "Keine starren Pakete und keine künstlichen Stufen. Wir vereinbaren Umfang, Ergebnisse und Zeitplan individuell nach Ihrem Bedarf – vom gezielten Review bis zur maßgeschneiderten Einführung.",
  },
  {
    step: "03",
    title: "Saubere Umsetzung & Übergabe",
    body: "Alles läuft auf Ihrer eigenen Infrastruktur unter Apache-2.0 oder als vereinbartes privates Modul – sauber dokumentiert, damit Ihr Team oder Integrator langfristig unabhängig bleibt.",
  },
];

const inquiryChecklist: readonly string[] = [
  "Beteiligte Datenquellen & Formate (z. B. PostgreSQL, Oracle/ODBC, Databricks, Iceberg, Delta, Parquet, S3/Azure/GCS)",
  "Identity Provider & Gruppenstruktur (z. B. Entra ID, Active Directory, Okta, Keycloak, OIDC/SAML)",
  "Ziel-Infrastruktur (Docker, Kubernetes, OpenShift, On-Premises, Air-Gapped oder Cloud)",
  "Wichtigste Ziele (Gruppenmaskierung, Power-BI-/Excel-Zugriff, Delta-Datenprodukte, eigene Quellen oder Detektoren)",
];

const supportFaq: readonly { q: string; a: string }[] = [
  {
    q: "Ist irgendeine Funktion hinter einem Supportvertrag oder einer Enterprise-Edition gesperrt?",
    a: "Nein. Jede Funktion – SSO, Rollen, Zeilenfilter, dynamische Spaltenmaskierung, SQL-/BI-Gateway, Datenanfragen, geteilte Datenprodukte, Audit-Log und Helm-Chart – steht zu 100 % unter Apache-2.0. Sie beauftragen uns nur dann, wenn Sie direkte Engineering-Unterstützung oder maßgeschneiderte Erweiterungen wünschen.",
  },
  {
    q: "Wie werden individuelle Anpassungen und Zusammenarbeit vereinbart?",
    a: "Jede Zusammenarbeit wird individuell nach Ihren technischen Anforderungen, Ihrem Zeitrahmen und Ihren internen Ressourcen abgestimmt – vom kompakten Architektur-Review oder eigenen Konnektor bis zur begleiteten Einführung.",
  },
  {
    q: "Können eigene Konnektoren oder Detektoren intern und privat bleiben?",
    a: "Ja. Konnektoren und Detektoren sind modulare Plugins. Allgemeine Verbesserungen können gern ins Open-Source-Repository einfließen, während unternehmensspezifische Integrationen und Geschäftsregeln vollständig privat in Ihrer Umgebung bleiben.",
  },
  {
    q: "Arbeiten Sie unter NDA und mit üblichen Beschaffungsprozessen?",
    a: "Ja. Wir arbeiten mit Organisationen in Österreich, der EU, Nordamerika und weltweit unter üblichen Vertraulichkeitsvereinbarungen (NDA) und direkten Projektverträgen.",
  },
  {
    q: "Wie melde ich eine Sicherheitslücke?",
    a: "Bitte senden Sie Hinweise direkt per E-Mail an contact@classifyre.com mit dem Betreff „Security“ statt ein öffentliches GitHub-Issue anzulegen, damit wir Prüfung und Behebung koordiniert durchführen können.",
  },
];

export default function SupportPageDe() {
  const siteUrl = siteOrigin();

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: "/de/" },
            { name: "Support", path: "/de/support/" },
          ]),
          generateContactPageSchema(siteUrl, "/de/support/", "de"),
          generateFaqSchema(supportFaq),
        ]}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <PageHero
          eyebrow="Support & Anpassung"
          title={
            <>
              Offen im Kern.
              <br />
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Individuell abgestimmt.
              </span>
            </>
          }
          lede={
            <>
              Jede Funktion von Classifyre steht offen unter Apache-2.0 – ohne
              gesperrte Stufen. Nutzen Sie unsere Dokumentation und das
              öffentliche Repository für den Eigenbetrieb oder arbeiten Sie
              direkt mit unseren Entwicklern zu individuell vereinbartem Umfang
              für IAM, eigene Quellen, Delta-Datenprodukte oder Detektoren.
            </>
          }
          actions={
            <>
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black hover:bg-accent/90"
              >
                <a
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre Anfrage")}`}
                >
                  {contactEmail}
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="border-2 border-white/35 bg-white/10 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:border-accent hover:bg-white/15 hover:text-accent"
              >
                <a href="/de/get/">Installationsleitfaden</a>
              </Button>
            </>
          }
        />

        {/* ── Self-Service & Community ─────────────────────────────────── */}
        <section aria-labelledby="self-service-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="self-service-title"
                marker="Self-Service & Community"
                title="Direkte Ressourcen für den Eigenbetrieb"
                lede="Schnelleinstieg in Dokumentation, öffentliche Issue-Verwaltung, Live-Demo und Release Notes."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {selfService.map((item, index) => (
                  <Reveal key={item.marker} delayMs={index * 60} className="h-full">
                    <a
                      href={item.href}
                      {...(item.external ? { target: "_blank", rel: "noreferrer" } : null)}
                      className="group flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-5 transition-colors hover:border-accent"
                    >
                      <Marker label={item.marker} />
                      <h3 className="font-sans text-base font-bold leading-snug text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                      <span className="mt-auto pt-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent-ink group-hover:underline dark:text-accent">
                        {item.label} →
                      </span>
                    </a>
                  </Reveal>
                ))}
              </div>
            </div>
          </SectionShell>
        </section>

        {/* ── Individuelle Engineering-Unterstützung ───────────────────── */}
        <section aria-labelledby="support-topics-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="support-topics-title"
                marker="Direktes Engineering"
                title="Wobei wir Organisationen unterstützen"
                lede="Umfang, Ergebnisse und Zeitplan werden individuell mit Ihrem Team vereinbart – ohne starre Pakete und ohne Herstellerbindung."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tailoringAreas.map((item, index) => (
                  <Reveal key={item.marker} delayMs={index * 60} className="h-full">
                    <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                      <Marker label={item.marker} />
                      <h3 className="font-sans text-lg font-bold leading-snug text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </SectionShell>
        </section>

        {/* ── Ablauf & Checkliste für Anfragen ─────────────────────────── */}
        <section aria-labelledby="how-we-work-title">
          <SectionShell tone="signal" fullWidth className="bg-black">
            <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
              <div className="space-y-8 lg:col-span-7">
                <div className="space-y-3">
                  <Marker label="Ablauf" />
                  <h2
                    id="how-we-work-title"
                    className="font-hero text-[clamp(2.2rem,5vw,3.8rem)] uppercase leading-[0.9] tracking-[0.01em] text-white"
                  >
                    Direkt mit den Entwicklern. Individuell vereinbart.
                  </h2>
                </div>
                <ol className="space-y-6">
                  {collaborationSteps.map((s) => (
                    <li
                      key={s.step}
                      className="grid gap-3 border-t border-white/15 pt-5 sm:grid-cols-[4rem_1fr]"
                    >
                      <span className="font-hero text-4xl leading-none text-accent">
                        {s.step}
                      </span>
                      <div className="space-y-1.5">
                        <h3 className="font-sans text-base font-bold text-white">
                          {s.title}
                        </h3>
                        <p className="text-sm leading-6 text-white/75">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col justify-between gap-6 border-2 border-white/25 bg-white/[0.04] p-6 sm:p-8 lg:col-span-5">
                <div className="space-y-4">
                  <Marker label="Schnellster Einstieg" />
                  <h3 className="font-sans text-xl font-bold text-white">
                    Was bei Ihrer Nachricht hilft
                  </h3>
                  <p className="text-sm leading-6 text-white/75">
                    Ein paar kurze Stichpunkte zu folgenden Angaben helfen uns,
                    sofort konkret und technisch fundiert zu antworten:
                  </p>
                  <ul className="space-y-3 pt-1">
                    {inquiryChecklist.map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-3 text-sm leading-6 text-white/85"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 bg-accent"
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-white/15 pt-6">
                  <Button
                    asChild
                    size="lg"
                    className="border-2 border-accent bg-accent font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black hover:bg-accent/90"
                  >
                    <a
                      href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre technische Anfrage")}`}
                    >
                      E-Mail an {contactEmail}
                    </a>
                  </Button>
                  <DocsLink href={docs.deployment} tone="signal">
                    Deployment-Doku
                  </DocsLink>
                </div>
              </div>
            </div>
          </SectionShell>
        </section>

        {/* ── Support FAQ ──────────────────────────────────────────────── */}
        <FaqList
          id="support-faq-title"
          mark="Support-FAQ"
          title="Fragen zur Zusammenarbeit."
          items={supportFaq}
          locale="de"
        />
      </main>
    </>
  );
}
