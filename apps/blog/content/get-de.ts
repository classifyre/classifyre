import type { GetCopy } from "./get";

import { docs } from "@/lib/site";

/**
 * German /get copy, type-checked against `GetCopy`.
 */

const deHero = {
  titleLead: "In Minuten startklar.",
  titleHighlight: "Skalierbar im Cluster.",
  micro: "100 % Open Source (Apache-2.0) · ohne Registrierung",
  ctaDocker: "Docker",
  ctaKubernetes: "Kubernetes & OpenShift",
} as const;

const deMascots = {
  lookingAround: "Classifyre Deployment-Übersicht",
} as const;

const deDocker = {
  marker: "Option 01 · Docker",
  title: "Lokal mit Docker evaluieren",
  lede: "Ein vollständiges Image für macOS, Windows und Linux. PostgreSQL sowie Scan- und Abfrage-Worker sind integriert – Sie testen Classifyre in wenigen Minuten mit echten Daten.",
  cardLabel: "All-in-One-Container",
  footnote: {
    beforeHost: "Anschließend ",
    host: "localhost:3000",
    afterHost:
      " öffnen. Benötigt Docker und 4 GB RAM. Die Volumes erhalten Ihre Konfiguration über Upgrades hinweg – der ",
    linkLabel: "Docker-Leitfaden",
    afterLink:
      " beschreibt Umgebungsvariablen, externe Datenbanken und Object Storage.",
  },
  includes: [
    {
      title: "Integriertes PostgreSQL",
      body: "PostgreSQL wird im Image mitgeliefert und automatisch auf den verfügbaren Speicher abgestimmt. Für größere Umgebungen wechseln Sie einfach per DATABASE_URL auf Ihren eigenen Datenbankserver.",
    },
    {
      title: "Isolierte Scan- & Abfrage-Worker",
      body: "Extraktion, Erkennung und SQL-Abfragen laufen in kurzlebigen, isolierten Prozessen – mit exakt derselben Engine wie als Jobs auf Kubernetes und OpenShift.",
    },
    {
      title: "Lokale Dateien direkt lesen",
      body: "Binden Sie lokale Ordner schreibgeschützt ein, um Klassifizierung und Parquet-/CSV-Abfragen zu testen, ohne Daten zu kopieren.",
    },
    {
      title: "Alles bleibt auf Ihrem System",
      body: "Quellen, verschlüsselte Zugangsdaten, Klassifizierungen, Regeln und Audit-Logs bleiben ausschließlich in Ihren lokalen Volumes.",
    },
  ],
} as const;

const deFirstRun = {
  marker: "Erste Schritte",
  title: "In vier Schritten zum kontrollierten Datenzugriff",
  lede: "Jeder Schritt erfolgt direkt in der Weboberfläche – ganz ohne manuelle Konfigurationsdateien.",
  action: { label: "App-Tour ansehen", href: docs.inTheApp },
  steps: [
    {
      step: "01",
      title: "Container starten",
      body: "Docker-Befehl ausführen und localhost:3000 öffnen. Beim ersten Start richtet Classifyre Datenbank, Identity-Service und Standard-Workspace automatisch ein.",
    },
    {
      step: "02",
      title: "Erste Quelle verbinden",
      body: "Verbinden Sie eine Datenbank, ein Iceberg- oder Delta-Lakehouse, einen S3-/Azure-/GCS-Bucket, Confluence oder einen lokalen Ordner. Zugangsdaten werden verschlüsselt gespeichert.",
      href: docs.sourceConfiguration,
      hrefLabel: "Quellen konfigurieren",
    },
    {
      step: "03",
      title: "Detektoren aktivieren & klassifizieren",
      body: "Aktivieren Sie fertige PII- und Secret-Pakete oder eigene Regex-, Python-, lokale CPU-KI- oder LLM-Detektoren. Die Klassifizierung steuert die Spaltenmaskierung automatisch.",
      href: docs.preBuiltDetectors,
      hrefLabel: "Detektor-Referenz",
    },
    {
      step: "04",
      title: "Gruppenrechte setzen & abfragen",
      body: "Vergeben Sie Gruppenrechte mit Zeilenfiltern und Spaltenmasken und fragen Sie live über den SQL-Editor, Power BI, Excel oder ODBC ab – jeder Zugriff wird protokolliert.",
      href: docs.whoMayQuery,
      hrefLabel: "Zugriff & Maskierung",
    },
  ],
} as const;

const deKubernetes = {
  marker: "Option 02 · Kubernetes & OpenShift",
  title: "Produktiv auf Ihrem Cluster betreiben",
  lede: "Exakt derselbe Apache-2.0-Kern als Helm-Chart für Kubernetes und OpenShift: Weboberfläche, API sowie zustandslose Scan- und Abfrage-Worker, die zwischen Läufen auf null skalieren.",
  ctaDocs: "Kubernetes- & OpenShift-Anleitung",
  ctaChartReadme: "Helm-Chart-README auf GitHub",
  helmLabel: "OCI-Helm-Chart",
  helmTitle: "Produktivbetrieb auf Kubernetes & OpenShift",
  inspectLabel: "Chart-Metadaten prüfen",
  installLabel: "Mit Helm installieren",
  prerequisitesLabel: "Voraussetzungen",
  prerequisites: [
    { label: "Kubernetes / OpenShift", value: "K8s ≥ 1.26 / OpenShift 4+" },
    { label: "Helm", value: "≥ 3.8" },
    { label: "Ingress / Route", value: "nginx oder OpenShift Routes" },
    { label: "PostgreSQL", value: "14+ extern (oder eingebettet für Demos)" },
  ],
  imagesLabel: "Container-Images · Multi-Arch",
  imagesValue: "linux/amd64 + linux/arm64",
  docsLinkLabel: "Dokumentation lesen",
  docs: [
    {
      title: "Kubernetes- & OpenShift-Leitfaden",
      body: "Values-Dateien für den Produktivbetrieb, externes PostgreSQL, CloudNativePG, TLS-Ingress, Skalierung und Storage.",
      href: docs.kubernetes,
    },
    {
      title: "Datenbank-Konfiguration",
      body: "Schema-Aufbau, automatische Migrationen bei Upgrades und Anbindung von Managed PostgreSQL.",
      href: docs.database,
    },
    {
      title: "Object Storage",
      body: "Optionale S3-kompatible Buckets für Scan-Logs, Exporte und verwaltete Datenartefakte.",
      href: docs.storage,
    },
    {
      title: "Upgrades & Versionierung",
      body: "Nachvollziehbare Image-Tags passend zur Chart-Version und sichere Update-Pfade.",
      href: docs.upgrades,
    },
  ],
} as const;

const deWhich = {
  marker: "Entscheidungshilfe",
  title: "Lokal starten, nahtlos im Cluster wachsen",
  lede: "Beide Varianten nutzen denselben Open-Source-Code und dieselben Container-Images.",
  dockerHead: "Docker wählen, wenn",
  dockerPoints: [
    "Sie Classifyre evaluieren oder einen schnellen Proof of Concept durchführen.",
    "Sie Klassifizierung, Maskierung sowie Power BI / SQL in wenigen Minuten lokal testen möchten.",
    "Alles auf einer einzelnen Workstation oder VM laufen soll.",
    "Sie noch keine externe Infrastruktur bereitstellen möchten.",
  ],
  kubernetesHead: "Kubernetes oder OpenShift wählen, wenn",
  kubernetesPoints: [
    "Mehrere Abteilungen und Teams die Plattform gemeinsam in Workspaces nutzen.",
    "Scans, Qualitätsprüfungen und Datenprodukte zeitgesteuert im Dauerbetrieb laufen.",
    "Große Datenbanken und Lakehouses elastische Worker-Skalierung erfordern.",
    "Produktivsicherheit, Hochverfügbarkeit, TLS und Ihr bestehender Cluster-Betrieb maßgeblich sind.",
  ],
  supportNote:
    "Alle Funktionen stehen unter Apache-2.0 im offenen Quellcode – SSO, Rollen, Zeilenfilter, dynamische Maskierung, SQL/BI-Gateway und Datenprodukte. Wenn Sie Unterstützung bei IAM-Integration, Sicherheitsarchitektur, eigenen Quellen oder Delta-Datenprodukten wünschen, sprechen Sie direkt mit unserem Engineering-Team.",
  supportCta: "Support & individuelle Einführung",
} as const;

const deClosing = {
  titleLead: "Testen Sie es mit",
  titleHighlight: "echten Daten.",
  body: "Der aussagekräftigste Test ist eine Datenbank oder ein Lakehouse aus Ihrem Alltag. Container starten, erste Quelle verbinden und Zeilenfilter sowie Spaltenmaskierung live prüfen.",
  ctaShowcase: "Live-Demo ansehen",
  linkSource: "Quellcode auf GitHub",
  linkSources: "Unterstützte Quellen",
  linkDocs: "Dokumentation",
} as const;

const de: GetCopy = {
  hero: deHero,
  mascots: deMascots,
  quickstart: {
    marker: "Schnellstart",
    title: "Zwei Befehle. Derselbe Open-Source-Kern.",
    lede: "Mit einem Docker-Container lokal evaluieren oder per Helm direkt auf Kubernetes und OpenShift betreiben.",
  },
  docker: deDocker,
  firstRun: deFirstRun,
  kubernetes: deKubernetes,
  which: deWhich,
  closing: deClosing,
};

export default de;
