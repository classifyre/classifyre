import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CookieSettingsButton } from "@workspace/ui/components";

import { translate } from "@/i18n";
import { Marker, PageHero, SectionShell } from "@/components/page-kit";
import {
  enterpriseContactEmail,
  marketingSiteUrl,
  repoUrl,
  showcaseUrlFor,
} from "@/lib/site";

import "../../../landing.css";

/**
 * Datenschutz- und Cookie-Richtlinie für die öffentlichen Classifyre-Websites.
 *
 * Two things this page is deliberately careful about:
 *
 * 1. **Sie deckt die Websites ab, nicht die Software.** Classifyre ist
 *    Apache-2.0-Software, die Menschen auf eigenen Maschinen betreiben. Für
 *    solche Deployments ist der Betreiber der Verantwortliche und wir sind
 *    überhaupt keine Partei — das schlicht zu sagen, bewahrt ein
 *    Open-Source-Projekt davor, als Datenverarbeiter jeder Installation
 *    gelesen zu werden.
 * 2. **Sie passt zum Code.** Jeder Cookie, der hier steht, ist einer, den die
 *    Site wirklich setzen kann (siehe `packages/ui/src/lib/cookie-consent.ts`
 *    und die Analytics-Provider). Kommt ein Anbieter dazu oder weg, müssen
 *    diese Tabelle und `COOKIE_CONSENT_VERSION` beide mit.
 */

/**
 * Registered operator details.
 *
 * TODO(legal): GDPR Art. 13(1)(a) requires the controller's identity — fill in
 * the registered legal name and postal address before this page goes public.
 * `postalAddress: null` renders the line as pending rather than inventing one.
 */
const operator = {
  tradingName: "Classifyre",
  legalName: null as string | null,
  postalAddress: null as string | null,
  country: "Österreich, Europäische Union",
  email: enterpriseContactEmail,
};

const lastUpdated = "4. August 2026";

export const metadata: Metadata = {
  title: "Datenschutz- & Cookie-Richtlinie",
  description:
    "Wie die Classifyre-Websites mit Ihren Daten umgehen: was die Analyse-Cookies tun, ihre Rechtsgrundlage, wie Sie die Einwilligung widerrufen, und warum selbst gehostete Classifyre-Deployments uns überhaupt nichts senden.",
  alternates: {
    canonical: "/de/privacy/",
    languages: {
      en: "/privacy/",
      de: "/de/privacy/",
      "x-default": "/privacy/",
    },
  },
  openGraph: {
    title: "Classifyre — Datenschutz- & Cookie-Richtlinie",
    description:
      "Nur Analyse-Cookies, im EWR Consent-gesteuert, und gar nichts aus selbst gehosteten Deployments.",
    type: "website",
  },
};

function Clause({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t-2 border-border pt-8">
      <div className="space-y-3">
        <Marker label={number} />
        <h2
          id={id}
          className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]"
        >
          {title}
        </h2>
      </div>
      <div className="space-y-4 text-base leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden="true" className="mt-2 h-1.5 w-3 shrink-0 bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
    >
      {children}
    </a>
  );
}

/** One row of the cookie table. Kept in sync with what the code actually sets. */
const cookies: readonly {
  name: string;
  purpose: string;
  provider: string;
  retention: string;
  category: "Essenziell" | "Analyse";
}[] = [
  {
    name: "classifyre-cookie-consent",
    purpose:
      "Speichert Ihre Antwort auf das Cookie-Banner, damit Sie nicht auf jeder Seite gefragt werden.",
    provider: "Classifyre (First-Party)",
    retention: "6 Monate",
    category: "Essenziell",
  },
  {
    name: "classifyre-blog-theme-v2",
    purpose:
      "Merkt sich Light- oder Dark-Mode. Liegt im Local Storage Ihres Browsers, wird nirgendwohin gesendet.",
    provider: "Classifyre (First-Party)",
    retention: "Bis Sie Site-Daten löschen",
    category: "Essenziell",
  },
  {
    name: "_ga, _ga_*",
    purpose:
      "Google Analytics: unterscheidet einen Browser vom anderen, damit Besuche nicht doppelt gezählt werden.",
    provider: "Google Ireland Ltd.",
    retention: "Bis zu 24 Monate",
    category: "Analyse",
  },
  {
    name: "ph_*",
    purpose:
      "PostHog: erkennt einen wiederkehrenden Browser, damit eine Folge von Seitenaufrufen als ein Besuch liest.",
    provider: "PostHog (EU-Region)",
    retention: "Bis zu 12 Monate",
    category: "Analyse",
  },
];

export default function PrivacyPageDe() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Datenschutz"
        title={
          <>
            Datenschutz- &amp;
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Cookie-Richtlinie
            </span>
          </>
        }
        lede={
          <>
            Kurzfassung: Diese Website zählt Seitenaufrufe, und nur, wenn Sie
            Ja sagen. Die Software selbst betreiben Sie auf Ihren eigenen
            Maschinen — sie sendet uns nichts, niemals, und wir sehen nie, was
            Sie damit scannen.
          </>
        }
        aside={
          <div className="flex flex-col gap-3">
            <div className="border-2 border-white/20 bg-white/[0.04] p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Gilt für
              </p>
              <p className="mt-2 text-white/78">
                www.classifyre.com und docs.classifyre.com
              </p>
            </div>
            <div className="border-2 border-white/20 bg-white/[0.04] p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Zuletzt aktualisiert
              </p>
              <p className="mt-2 text-white/78">{lastUpdated}</p>
            </div>
          </div>
        }
      />

      <SectionShell>
        <div className="mx-auto max-w-3xl space-y-10">
          <p className="text-lg leading-8 text-muted-foreground">
            Diese Richtlinie erklärt, was die Classifyre-Websites erheben,
            warum, und was Sie dagegen tun können. Sie ist zum Lesen
            geschrieben, nicht zum Überleben, und sie beschreibt, was der Code
            auf diesen Sites wirklich tut — die Source ist{" "}
            <ExternalLink href={repoUrl}>öffentlich</ExternalLink>, Sie können
            also nachprüfen.
          </p>

          <Clause id="who-we-are" number="01" title="Wer wir sind">
            <p>
              {operator.tradingName} ist ein Open-Source-Projekt, betrieben aus{" "}
              {operator.country}. Für die unten beschriebenen Websites sind wir
              der Verantwortliche im Sinne der Datenschutz-Grundverordnung
              (DSGVO).
            </p>
            <div className="border-2 border-border bg-muted/30 p-5 text-sm leading-6">
              <p>
                <strong className="text-foreground">Betreiber:</strong>{" "}
                {operator.legalName ?? operator.tradingName}
              </p>
              {operator.postalAddress ? (
                <p>
                  <strong className="text-foreground">Adresse:</strong>{" "}
                  {operator.postalAddress}
                </p>
              ) : null}
              <p>
                <strong className="text-foreground">E-Mail:</strong>{" "}
                <a
                  href={`mailto:${operator.email}`}
                  className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
                >
                  {operator.email}
                </a>
              </p>
              <p>
                <strong className="text-foreground">Website:</strong>{" "}
                {marketingSiteUrl.replace("https://", "")}
              </p>
            </div>
            <p>
              Wir haben keinen Datenschutzbeauftragten bestellt; wir müssen
              auch keinen bestellen. Schreiben Sie für alles, was diese
              Richtlinie betrifft, an die Adresse oben.
            </p>
          </Clause>

          <Clause id="scope" number="02" title="Was das abdeckt — und was nicht">
            <p>Diese Richtlinie deckt die Websites ab, die wir betreiben:</p>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    {marketingSiteUrl.replace("https://", "")}
                  </strong>{" "}
                  — diese Site, inklusive Blog.
                </>,
                <>
                  <strong className="text-foreground">docs.classifyre.com</strong>{" "}
                  — die Dokumentations-Site.
                </>,
                <>
                  <strong className="text-foreground">showcase.classifyre.com</strong>{" "}
                  — die öffentliche Read-only-Showcase, behandelt in Abschnitt 08.
                </>,
              ]}
            />
            <p>
              Sie deckt die Classifyre-Software selbst{" "}
              <strong className="text-foreground">nicht</strong> ab. Classifyre
              ist Apache-2.0-lizenzierte Software, die Sie auf Ihren eigenen
              Maschinen oder in Ihrem eigenen Cluster installieren und
              betreiben. Dabei spricht das Deployment mit Ihrer Infrastruktur
              und nicht mit uns: Wir erhalten keine Telemetrie, keine
              Scan-Ergebnisse, keine Dokumente und keine Benutzerkonten daraus.
              Für Ihr eigenes Deployment sind Sie der Verantwortliche, und wir
              sind an der Verarbeitung überhaupt nicht beteiligt.
            </p>
          </Clause>

          <Clause id="what-we-collect" number="03" title="Was wir erheben">
            <p>
              <strong className="text-foreground">Server-Logs.</strong> Wie jeder
              Webserver protokolliert unser Hosting-Anbieter Requests:
              IP-Adresse, Zeit, aufgerufene Seite, Referrer und
              Browser-User-Agent. Sie dienen dazu, die Site am Laufen zu halten
              und Missbrauch zu erkennen, und werden nicht mit den Analysedaten
              unten zusammengeführt.
            </p>
            <p>
              <strong className="text-foreground">
                Analyse, wenn Sie zustimmen.
              </strong>{" "}
              Wenn Sie Analyse-Cookies akzeptieren, erfassen wir, welche Seiten
              gelesen werden, in welcher Reihenfolge, wie lange, grob woher
              (Länderebene) und auf welcher Art Gerät. Wir nutzen das, um zu
              entscheiden, was wir schreiben und dokumentieren. Wir bauen keine
              Werbeprofile, wir betreiben keine Ad-Netzwerke, und wir verkaufen
              oder vermieten nichts davon.
            </p>
            <p>
              Wir fragen nach keinem Konto, und es gibt keinen Login auf diesen
              Sites. Wenn Sie uns mailen, haben wir natürlich Ihre E-Mail — wir
              behalten die Korrespondenz und sonst nichts.
            </p>
          </Clause>

          <Clause id="cookies" number="04" title="Cookies, die wir setzen">
            <p>
              Essenzielle Einträge werden ohne Nachfrage gesetzt, weil sie Ihre
              eigenen Entscheidungen festhalten — das ist die enge Ausnahme, die
              die ePrivacy-Richtlinie erlaubt. Analyse-Cookies werden erst
              gesetzt, wenn Sie auf Akzeptieren drücken.
            </p>

            <div className="overflow-x-auto border-2 border-border">
              <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40">
                    {["Name", "Kategorie", "Zweck", "Anbieter", "Gespeichert für"].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((cookie) => (
                    <tr
                      key={cookie.name}
                      className="border-b border-border last:border-b-0 align-top"
                    >
                      <td className="px-4 py-3 font-mono text-[12px] text-foreground">
                        {cookie.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            cookie.category === "Essenziell"
                              ? "inline-flex border-2 border-border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                              : "inline-flex border-2 border-accent bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black"
                          }
                        >
                          {cookie.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.purpose}
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.provider}
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.retention}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p>
              Sie können Ihre Meinung jederzeit ändern, mit einem Klick:
            </p>
            <div className="flex flex-wrap items-center gap-3 border-2 border-border bg-muted/30 p-5">
              <CookieSettingsButton
                label={translate("de", "footer.cookieSettings")}
                className="h-9 cursor-pointer border-2 border-accent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-black transition-colors hover:bg-transparent hover:text-foreground hover:no-underline"
              />
              <span className="text-sm leading-6">
                Öffnet die Consent-Leiste erneut, damit Sie wieder akzeptieren
                oder ablehnen können.
              </span>
            </div>
            <p>
              Ihr Browser kann Cookies auch pauschal blockieren oder löschen,
              und Google veröffentlicht ein{" "}
              <ExternalLink href="https://tools.google.com/dlpage/gaoptout">
                Google-Analytics-Opt-out-Add-on
              </ExternalLink>
              . Ablehnen kostet Sie hier nichts: Jede Seite funktioniert so oder
              so identisch.
            </p>
          </Clause>

          <Clause id="legal-basis" number="05" title="Rechtsgrundlagen">
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    Einwilligung (Art. 6 Abs. 1 lit. a DSGVO)
                  </strong>{" "}
                  für Analyse-Cookies und alles, was sie erheben. Wir fragen,
                  bevor irgendetwas lädt, Ablehnen ist ein Klick und steht neben
                  Akzeptieren, und eine Absage hat keine Folgen für Sie.
                </>,
                <>
                  <strong className="text-foreground">
                    Berechtigte Interessen (Art. 6 Abs. 1 lit. f DSGVO)
                  </strong>{" "}
                  für Server-Logs und Missbrauchsprävention — das Interesse ist,
                  eine öffentliche Website verfügbar und unangegriffen zu halten.
                </>,
                <>
                  <strong className="text-foreground">
                    Rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO)
                  </strong>{" "}
                  wo das Gesetz verlangt, dass wir etwas aufbewahren oder
                  herausgeben.
                </>,
              ]}
            />
          </Clause>

          <Clause id="processors" number="06" title="Wer es sonst sieht">
            <p>
              Wir halten diese Liste absichtlich kurz. Jeder Name hier ist ein
              Auftragsverarbeiter, der in unserem Auftrag nach Art. 28 DSGVO
              handelt.
            </p>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">PostHog</strong> —
                  Produktanalyse, konfiguriert auf seiner{" "}
                  <strong className="text-foreground">EU-Region</strong>, damit
                  diese Events in der Europäischen Union bleiben. Siehe die{" "}
                  <ExternalLink href="https://posthog.com/privacy">
                    PostHog-Datenschutzerklärung
                  </ExternalLink>
                  .
                </>,
                <>
                  <strong className="text-foreground">Google Analytics 4</strong>{" "}
                  (Google Ireland Ltd.) — Seitenaufruf-Statistik. Google kann
                  Daten unter dem EU-US Data Privacy Framework und
                  Standardvertragsklauseln in die USA übermitteln. Siehe{" "}
                  <ExternalLink href="https://policies.google.com/technologies/partner-sites">
                    wie Google Daten von Sites verwendet, die seine Dienste nutzen
                  </ExternalLink>
                  .
                </>,
                <>
                  <strong className="text-foreground">
                    Unser Hosting-Anbieter
                  </strong>{" "}
                  — serviert die Seiten und hält die Request-Logs aus Abschnitt 03.
                </>,
              ]}
            />
            <p>
              Niemand sonst. Wir verkaufen keine personenbezogenen Daten, wir
              haben nie personenbezogene Daten verkauft, und es gibt keine
              Werbe- oder Datenbroker-Integrationen auf diesen Sites.
            </p>
          </Clause>

          <Clause id="retention" number="07" title="Wie lange wir es behalten">
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">Analyse-Daten:</strong> bis
                  zu 14 Monate in Google Analytics, bis zu 12 Monate in PostHog,
                  danach bleiben nur aggregierte Zählungen.
                </>,
                <>
                  <strong className="text-foreground">Server-Logs:</strong>{" "}
                  typischerweise 30 Tage, länger nur, während ein konkreter
                  Vorfall untersucht wird.
                </>,
                <>
                  <strong className="text-foreground">
                    E-Mails, die Sie uns schicken:
                  </strong>{" "}
                  solange das Gespräch läuft, danach nur, wo wir einen Grund
                  haben, sie zu behalten.
                </>,
              ]}
            />
          </Clause>

          <Clause
            id="self-hosted"
            number="08"
            title="Selbst gehostete Deployments und die Showcase"
          >
            <p>
              <strong className="text-foreground">
                Ihre eigene Installation.
              </strong>{" "}
              Eine Classifyre-Instanz, die Sie betreiben — Docker, Kubernetes
              oder sonst wie — telefoniert nicht nach Hause. Kein Lizenz-Check,
              kein Usage-Beacon, kein Crash-Reporting an uns. Was sie scannt,
              bleibt in Ihrer Datenbank, und Sie sind dafür der Verantwortliche.
              Die Software steht unter der Apache-2.0-Lizenz, die ihre
              Gewährleistungs- und Haftungsterme enthält; nichts auf dieser
              Seite legt etwas dazu.
            </p>
            <p>
              <strong className="text-foreground">
                Die öffentliche Showcase.
              </strong>{" "}
              <ExternalLink href={showcaseUrlFor("de")}>showcase.classifyre.com</ExternalLink> ist
              eine bewusst öffentliche Read-only-Instanz, die wir betreiben,
              damit sich Leute umsehen können, bevor sie etwas installieren. Sie
              ist ein Schaufenster, kein Tresor: Behandeln Sie alles darin als
              öffentlich, und laden Sie keine echten personenbezogenen Daten,
              Credentials oder sonst Vertrauliches hoch. Wir können sie ohne
              Ankündigung zurücksetzen.
            </p>
          </Clause>

          <Clause id="your-rights" number="09" title="Ihre Rechte">
            <p>
              Nach der DSGVO können Sie von uns verlangen, Ihnen eine Kopie
              Ihrer personenbezogenen Daten zu geben, sie zu berichtigen, zu
              löschen, ihre Verwendung einzuschränken oder ihr zu
              widersprechen, oder sie in portabler Form herauszugeben. Wo wir
              uns auf Einwilligung stützen, können Sie sie jederzeit widerrufen
              — mit dem Button in Abschnitt 04 — ohne dass berührt, was davor
              rechtmäßig war.
            </p>
            <p>
              E-Mail{" "}
              <a
                href={`mailto:${operator.email}`}
                className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
              >
                {operator.email}
              </a>
              . Wir antworten innerhalb eines Monats. Anfragen sind kostenlos,
              außer sie sind offenkundig exzessiv.
            </p>
            <p>
              Sie haben auch das Recht, sich bei einer Aufsichtsbehörde zu
              beschweren. In Österreich ist das die{" "}
              <ExternalLink href="https://www.dsb.gv.at/">
                Datenschutzbehörde
              </ExternalLink>
              ; anderswo im EWR steht Ihre nationale Behörde in der Liste des{" "}
              <ExternalLink href="https://edpb.europa.eu/about-edpb/about-edpb/members_en">
                Europäischen Datenschutzausschusses
              </ExternalLink>
              .
            </p>
          </Clause>

          <Clause id="children" number="10" title="Kinder">
            <p>
              Diese Sites sind Dokumentation und Marketing für
              Infrastruktur-Software; sie richten sich nicht an Kinder, und wir
              erheben wissentlich keine Daten von Personen unter 16. Wenn Sie
              glauben, ein Kind habe uns personenbezogene Daten geschickt, sagen
              Sie uns Bescheid, und wir löschen sie.
            </p>
          </Clause>

          <Clause id="changes" number="11" title="Änderungen dieser Richtlinie">
            <p>
              Wenn sich das, was wir erheben, materiell ändert, aktualisieren
              wir diese Seite, ändern das Datum oben und setzen die gespeicherte
              Einwilligung zurück, damit das Banner erneut fragt, statt sich auf
              eine Antwort zu verlassen, die Sie zu etwas anderem gegeben haben.
              Redaktionelle Fixes lösen das nicht aus.
            </p>
            <p className="text-sm">Zuletzt aktualisiert: {lastUpdated}.</p>
          </Clause>
        </div>
      </SectionShell>
    </main>
  );
}
