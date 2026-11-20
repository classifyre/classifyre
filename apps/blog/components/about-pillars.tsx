import type { Locale } from "@/lib/locale";
import { docs } from "@/lib/site";
import { Marker, SectionHead, SectionShell } from "@/components/page-kit";
import { Reveal } from "@/components/reveal";

/**
 * "What Classifyre does" on the About page: the five pillars, in the order
 * the story is told everywhere (homepage, deck, LinkedIn). Each pillar is a
 * promise; the line under it is the proof. Discovery is the start of the
 * masking pillar and investigation is the last line, never a pillar.
 */

type Pillar = { marker: string; title: string; body: string; href: string; hrefLabel: string };

const COPY: Record<
  Locale,
  { marker: string; title: string; lede: string; pillars: readonly Pillar[]; coda: string }
> = {
  en: {
    marker: "What Classifyre does",
    title: "One governed way into your data",
    lede: "Five promises, each with the proof underneath.",
    pillars: [
      {
        marker: "01 · Access",
        title: "Access follows your organisation",
        body: "Groups, departments, roles and locations decide which sources, tables, rows and columns a person sees. Groups come from your directory; row filters work per group; grants carry end dates; workspace admins don't read clear data by default.",
        href: docs.whoMayQuery,
        hrefLabel: "Who may query what",
      },
      {
        marker: "02 · Masking",
        title: "Sensitive data is masked by default",
        body: "Classification decides what is personal: 41 kinds of personal data, including Austrian, German and Swiss identifiers. Masks apply inside the query (redacted, last four, hashed, hidden), so WHERE and JOIN cannot leak. The hashed mask is pseudonymisation in the sense of the GDPR.",
        href: docs.masking,
        hrefLabel: "How masking works",
      },
      {
        marker: "03 · Data products",
        title: "Teams build data products on governed data",
        body: "Yes — teams can build data products: shared datasets join sources live, with an owning group and readers per group. They are sharable assets, queried with the same governance as the sources underneath. The masks of every input travel with them as a floor. Owners, stewards, quality rules and ODCS contracts keep them reviewed.",
        href: docs.sharedDatasets,
        hrefLabel: "Shared datasets",
      },
      {
        marker: "04 · Tools",
        title: "People use it in the tools they have",
        body: "SQL, Excel, Power BI, Tableau and AI agents over MCP, each on a personal, expiring connection over the PostgreSQL protocol. No shared passwords, and an agent never reads more than the person behind it.",
        href: docs.sqlConnections,
        hrefLabel: "SQL connections",
      },
      {
        marker: "05 · Proof",
        title: "Every read is on record, and nothing leaves your infrastructure",
        body: "The read log names the person, the table and the tool. Classifyre runs as one Docker image or a Helm chart — on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud — offline if you like, under Apache-2.0.",
        href: docs.deployment,
        hrefLabel: "Deployment options",
      },
    ],
    coda: "And when something does leak, the same findings feed inquiries, fingerprints across systems and cases, with an autopilot doing the legwork.",
  },
  de: {
    marker: "Was Classifyre tut",
    title: "Ein kontrollierter Zugang zu Ihren Daten",
    lede: "Fünf Versprechen, jedes mit dem Nachweis darunter.",
    pillars: [
      {
        marker: "01 · Zugriff",
        title: "Der Zugriff folgt Ihrer Organisation",
        body: "Gruppen, Abteilungen, Rollen und Standorte bestimmen, welche Quellen, Tabellen, Zeilen und Spalten eine Person sieht. Die Gruppen kommen aus Ihrem Verzeichnis; Zeilenfilter wirken pro Gruppe; Freigaben haben ein Ablaufdatum; Workspace-Admins lesen standardmäßig keinen Klartext.",
        href: docs.whoMayQuery,
        hrefLabel: "Wer was abfragen darf",
      },
      {
        marker: "02 · Maskierung",
        title: "Sensible Daten sind standardmäßig maskiert",
        body: "Die Klassifizierung entscheidet, was personenbezogen ist: 41 Arten personenbezogener Daten, darunter österreichische, deutsche und Schweizer Kennungen. Masken greifen in der Abfrage (geschwärzt, letzte vier, gehasht, ausgeblendet), also kann über WHERE und JOIN nichts abfließen. Die gehashte Maske ist Pseudonymisierung im Sinne der DSGVO.",
        href: docs.masking,
        hrefLabel: "So funktioniert die Maskierung",
      },
      {
        marker: "03 · Datenprodukte",
        title: "Teams bauen Datenprodukte auf kontrollierten Daten",
        body: "Ja — Teams können Datenprodukte bauen: Geteilte Datasets verknüpfen Quellen live, mit einer verantwortlichen Gruppe und Lesern pro Gruppe. Sie sind teilbare Assets und werden mit derselben Governance abgefragt wie die Quellen darunter. Die Masken jeder Eingangstabelle reisen als Untergrenze mit. Owner, Stewards, Qualitätsregeln und ODCS-Verträge halten sie geprüft.",
        href: docs.sharedDatasets,
        hrefLabel: "Geteilte Datasets",
      },
      {
        marker: "04 · Werkzeuge",
        title: "Menschen nutzen es in ihren Werkzeugen",
        body: "SQL, Excel, Power BI, Tableau und KI-Agenten über MCP, jeweils über eine persönliche, befristete Verbindung per PostgreSQL-Protokoll. Keine geteilten Passwörter, und ein Agent liest nie mehr als die Person dahinter.",
        href: docs.sqlConnections,
        hrefLabel: "SQL-Verbindungen",
      },
      {
        marker: "05 · Nachweis",
        title: "Jeder Zugriff protokolliert, nichts verlässt Ihre Server",
        body: "Das Protokoll nennt Person, Tabelle und Werkzeug. Classifyre läuft als Docker-Image oder Helm-Chart — On-Premises, in Ihrer eigenen Cloud oder auf Public-Cloud-Infrastruktur wie AWS, Azure oder Google Cloud —, auf Wunsch offline, unter Apache-2.0.",
        href: docs.deployment,
        hrefLabel: "Betriebsvarianten",
      },
    ],
    coda: "Und wenn doch etwas abfließt, speisen dieselben Befunde Anfragen, Fingerabdrücke über Systeme und Fälle, und ein Autopilot erledigt die Laufarbeit.",
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
            illustration="binders"
            title={copy.title}
            lede={copy.lede}
          />
          <ol className="grid gap-4 lg:grid-cols-2">
            {copy.pillars.map((pillar, index) => (
              <Reveal key={pillar.marker} as="li" delayMs={index * 70} className="h-full">
                <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                  <Marker label={pillar.marker} />
                  <h3 className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
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
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{copy.coda}</p>
        </div>
      </SectionShell>
    </section>
  );
}
