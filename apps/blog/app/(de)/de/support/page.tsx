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
  title: "Support & Kontakt",
  description:
    "Dokumentation, GitHub-Issues, Live-Demo und Release Notes für den Eigenbetrieb von Classifyre – und ein direkter Draht zu den Entwicklern bei Fragen zu Ihrer Umgebung.",
  alternates: {
    canonical: "/de/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre Support & Kontakt",
    description:
      "Self-Service-Ressourcen für den Eigenbetrieb und ein direkter Draht zu den Entwicklern bei Fragen.",
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

const questionTopics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "Evaluierung",
    title: "Passt es zu Ihrer Umgebung?",
    body: "Unsicher, ob Classifyre Ihre Quellen, Ihren Identity Provider oder Ihre Maskierungsregeln abdeckt? Fragen Sie vor der Installation – wir antworten lieber ehrlich, als dass Sie raten müssen.",
  },
  {
    marker: "Quellen",
    title: "Systeme, die wir noch nicht kennen",
    body: "Proprietäre oder ältere Systeme, interne APIs, EDI-Strecken oder Dateiformate, die nicht im Quellenkatalog stehen – erzählen Sie uns davon. Das fließt in die Weiterentwicklung ein.",
  },
  {
    marker: "Identität",
    title: "Ungewöhnliche Verzeichnis- und Gruppenstrukturen",
    body: "Verschachtelte Active-Directory-Gruppen, mehrere Entra-ID-Mandanten, Okta- oder Keycloak-Setups, die nicht direkt auf Workspaces und Rollen passen – beschreiben Sie Ihres, wir sagen Ihnen, wie es sich abbilden lässt.",
  },
  {
    marker: "Infrastruktur",
    title: "Air-Gapped, OpenShift & abgeschottete Cluster",
    body: "Fragen zum Betrieb ohne ausgehenden Datenverkehr, mit Images aus einer internen Registry oder wenn BI- und KI-Werkzeuge ausschließlich über das Gateway laufen sollen.",
  },
  {
    marker: "Detektoren & KI",
    title: "Fachspezifische Erkennung",
    body: "Eigene Regex- oder Python-Detektoren, Klassifizierungsmodelle auf der CPU oder ein privates LLM in Ihrem Netz – fragen Sie, wenn die Dokumentation nicht weiterhilft.",
  },
  {
    marker: "Feedback",
    title: "Was fehlt oder unklar ist",
    body: "Etwas hat nicht wie erwartet funktioniert, in der Doku fehlt ein Schritt oder Ihnen fehlt eine Funktion – all das hilft uns weiter.",
  },
];

const collaborationSteps: readonly { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Schreiben Sie uns",
    body: "Erzählen Sie, was Sie vorhaben und wo Sie hängen. Eine kurze Nachricht genügt – kein Formular, nichts zu unterschreiben.",
  },
  {
    step: "02",
    title: "Ein Entwickler liest mit",
    body: "Nachrichten landen bei den Menschen, die Classifyre entwickeln. Wir antworten so bald wie möglich und verweisen auf Doku oder Issue, wenn es die Antwort schon gibt.",
  },
  {
    step: "03",
    title: "Alle profitieren",
    body: "Zeigt Ihre Frage eine Lücke, landet die Korrektur im Open-Source-Repository oder in der Dokumentation – damit die nächste Person nicht darüber stolpert.",
  },
];

const inquiryChecklist: readonly string[] = [
  "Beteiligte Datenquellen und Formate (z. B. PostgreSQL, Oracle/ODBC, Databricks, Iceberg, Delta, Parquet, S3/Azure/GCS oder ein proprietäres System)",
  "Identity Provider und Gruppenstruktur (z. B. Entra ID, Active Directory, Okta, Keycloak, OIDC/SAML)",
  "Wo es läuft (Docker, Kubernetes, OpenShift, Air-Gapped)",
  "Was Sie erreichen möchten und wo Sie nicht weiterkommen",
];

const supportFaq: readonly { q: string; a: string }[] = [
  {
    q: "Ist irgendeine Funktion hinter einer kostenpflichtigen Edition gesperrt?",
    a: "Nein. Jede Funktion – SSO, Rollen, Zeilenfilter, dynamische Spaltenmaskierung, SQL-/BI-Gateway, Datenanfragen, geteilte Datenprodukte, Audit-Log und Helm-Chart – steht zu 100 % unter Apache-2.0. Es gibt keine Enterprise-Edition.",
  },
  {
    q: "Gibt es Classifyre als SaaS?",
    a: "Nein. Classifyre ist niemals Multi-Tenant-SaaS. Es läuft auf Ihrer eigenen Infrastruktur – Docker zur Evaluierung, Kubernetes oder OpenShift per Helm im Betrieb – betrieben von Ihrem eigenen Team oder dem Integrator, mit dem Sie bereits arbeiten.",
  },
  {
    q: "Kann ich eine Frage stellen, ohne mich zu irgendetwas zu verpflichten?",
    a: "Ja. Fragen, ob Classifyre zu Ihren Quellen, Ihrem Identity Provider oder Ihrer Infrastruktur passt, sind willkommen – ebenso Beschreibungen von Umgebungen, die die Dokumentation nicht abdeckt. Eine Nachricht an uns startet keinen Verkaufsprozess.",
  },
  {
    q: "Können eigene Konnektoren oder Detektoren intern und privat bleiben?",
    a: "Ja. Konnektoren und Detektoren sind modulare Plugins. Allgemeine Verbesserungen können gern ins Open-Source-Repository einfließen, während unternehmensspezifische Integrationen und Geschäftsregeln vollständig privat in Ihrer Umgebung bleiben.",
  },
  {
    q: "Wo melde ich Fehler oder Funktionswünsche?",
    a: "Eröffnen Sie ein Issue im öffentlichen GitHub-Repository, damit andere mitlesen und ergänzen können. Sind die Details vertraulich, schreiben Sie stattdessen an contact@classifyre.com.",
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
          eyebrow="Support & Kontakt"
          title={
            <>
              Offen im Kern.
              <br />
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Fragen willkommen.
              </span>
            </>
          }
          lede={
            <>
              Jede Funktion von Classifyre steht offen unter Apache-2.0 – ohne
              gesperrte Stufen – und läuft auf Ihrer eigenen Infrastruktur.
              Wenn Sie es evaluieren, auf etwas stoßen, das die Dokumentation
              nicht abdeckt, oder eine Umgebung haben, die wir noch nicht
              kennen: Schreiben Sie uns – wir lesen jede Nachricht.
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
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent("Frage zu Classifyre")}`}
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

        {/* ── Fragen, die wir gern hören ───────────────────────────────── */}
        <section aria-labelledby="support-topics-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="support-topics-title"
                marker="Fragen willkommen"
                title="Worüber wir gern von Ihnen hören"
                lede="Keine Frage ist zu früh oder zu speziell. Diese hier bekommen wir am häufigsten."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {questionTopics.map((item, index) => (
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

        {/* ── Ablauf & Checkliste für Nachrichten ──────────────────────── */}
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
                    Direkt zu den Entwicklern. Kein Verkaufsprozess.
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
                  <Marker label="Ihre Nachricht" />
                  <h3 className="font-sans text-xl font-bold text-white">
                    Was bei Ihrer Nachricht hilft
                  </h3>
                  <p className="text-sm leading-6 text-white/75">
                    Nichts davon ist Pflicht, aber ein Satz zu diesen Punkten
                    hilft uns, konkret zu antworten:
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
                      href={`mailto:${contactEmail}?subject=${encodeURIComponent("Frage zu Classifyre")}`}
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
          title="Fragen rund um Unterstützung."
          items={supportFaq}
          locale="de"
        />
      </main>
    </>
  );
}
