import type { GetCopy } from "./get";

import { docs } from "@/lib/site";

/**
 * German /get copy: a full translation of `en` in `./get.ts`,
 * type-checked against `GetCopy` so a missing string fails the build.
 * Links reuse the same shared URL constants as the English copy.
 */

const deHero = {
  titleLead: "Heute Nacht",
  titleHighlight: "läuft es.",
  micro: "kostenlos · keine Anmeldung",
  ctaDocker: "Docker",
  ctaKubernetes: "Kubernetes",
} as const;

const deMascots = {
  lookingAround:
    "Der Classifyre-Ermittler schaut sich um und sucht die Spur",
} as const;

const deDocker = {
  marker: "Option 01 · Docker",
  title: "Auf Ihrer Maschine betreiben",
  lede: "Ein Image, identisch auf macOS, Windows und Linux. Datenbank und Scan-Worker sind schon drin; nichts zu provisionieren, nichts anzubinden.",
  cardLabel: "Starten",
  footnote: {
    beforeHost: "Dann ",
    host: "localhost:3000",
    afterHost:
      " öffnen. Braucht Docker und 4 GB Memory. Diese Volumes tragen Ihre Arbeit über Upgrades: der ",
    linkLabel: "Docker-Guide",
    afterLink:
      " deckt die Umgebungsvariablen, externen Datenbanken und Object Storage ab.",
  },
  includes: [
    {
      title: "PostgreSQL, drinnen",
      body: "Die Datenbank steckt im Image, beim Start abgestimmt auf das Memory, das Sie dem Container gegeben haben. Zeigen Sie mit DATABASE_URL auf Ihren eigenen Server, wenn Sie herauswachsen.",
    },
    {
      title: "Scan-Worker, gesandboxt",
      body: "Extraktion und Detektion laufen als eigene Prozesse, die mit dem Scan enden, derselbe Code, den der Cluster als Kubernetes-Jobs fährt.",
    },
    {
      title: "Ordner mounten, scannen",
      body: "Mounten Sie ein Verzeichnis read-only und zeigen Sie mit einer Quelle darauf. Nichts wird herauskopiert; die Dateien werden gelesen, wo sie liegen.",
    },
    {
      title: "Alles bleibt liegen",
      body: "Quellen, Credentials, Befunde und Fälle leben in Volumes auf Ihrer Platte. Nichts wird zu uns hochgeladen.",
    },
  ],
} as const;

const deFirstRun = {
  marker: "Erster Lauf",
  title: "In vier Schritten zum ersten Befund",
  lede: "Nichts hier braucht eine Konfigurationsdatei. Jeder Schritt passiert in der App, und jeder hat eine Seite in der Doku, wenn Sie ins Detail wollen.",
  action: { label: "App-Tour", href: docs.inTheApp },
  steps: [
    {
      step: "01",
      title: "Image starten",
      body: "Ein Befehl, dann localhost:3000 öffnen. Der erste Boot initialisiert die Datenbank und legt einen Workspace an; geben Sie ihm auf einem Laptop ein paar Minuten.",
    },
    {
      step: "02",
      title: "Quelle anbinden",
      body: "Zeigen Sie auf etwas, das Sie bereits betreiben: eine Datenbank, einen S3-Bucket, einen Confluence-Space oder einfach einen lokalen Ordner. Credentials sind at rest verschlüsselt.",
      href: docs.sourceConfiguration,
      hrefLabel: "Quellen konfigurieren",
    },
    {
      step: "03",
      title: "Detektoren einschalten",
      body: "Aktivieren Sie die Built-in-Packs, die Sie interessieren: PII, Secrets, Security, Moderation, Qualität. Sie greifen beim ersten Scan, ganz ohne Modell-Setup.",
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
  ],
} as const;

const deKubernetes = {
  marker: "Option 02 · Kubernetes",
  title: "Oder auf Ihrem Cluster skalieren",
  lede: "Derselbe Open-Source-Kern als Helm-Chart: Web, API, Worker und ephemere Scan-Jobs, die unter Last auffächern und zwischen den Läufen auf null skalieren.",
  ctaDocs: "Vollständige Deployment-Anleitung",
  ctaChartReadme: "Chart-README auf GitHub",
  helmLabel: "Kein Repo-Add-Schritt",
  helmTitle: "Helm, OCI-nativ",
  inspectLabel: "Vor dem Installieren prüfen",
  installLabel: "Installieren",
  prerequisitesLabel: "Voraussetzungen",
  prerequisites: [
    { label: "Kubernetes", value: "≥ 1.26" },
    { label: "Helm", value: "≥ 3.8 (OCI-nativ)" },
    { label: "Ingress", value: "default: nginx" },
    { label: "PostgreSQL", value: "14+, extern, oder eingebettet für Demos" },
  ],
  imagesLabel: "Images · Multi-Arch",
  imagesValue: "linux/amd64 + linux/arm64",
  docsLinkLabel: "Doku lesen",
  docs: [
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
  ],
} as const;

const deWhich = {
  marker: "Unschlüssig",
  title: "Entscheiden Sie danach, wo die Daten bleiben müssen",
  lede: "Beide Runtimes tragen dieselben Features, und ein Namespace-Export trägt Ihre Arbeit von einer zur anderen; an diese Entscheidung sind Sie also nicht gekettet.",
  dockerHead: "Docker wählen, wenn",
  dockerPoints: [
    "Sie evaluieren oder allein ermitteln.",
    "Der Korpus liegt auf Ihrer Maschine oder ist von dort erreichbar.",
    "Nichts darf den Laptop verlassen.",
    "Sie wollen in zehn Minuten scannen.",
  ],
  kubernetesHead: "Kubernetes wählen, wenn",
  kubernetesPoints: [
    "Ein Team teilt sich die Instanz, aufgeteilt in Workspaces.",
    "Scans sollen nach Zeitplan laufen, unbeaufsichtigt.",
    "Der Bestand ist groß genug, um auffächernde Worker zu brauchen.",
    "Es muss in Ihrem bestehenden Cluster und Netz sitzen.",
  ],
  enterpriseNote:
    "Fragen Sie sich, was der Enterprise-Layer auf beide Runtimes noch drauflegt? Es sind SSO, Rollen und Autorisierung pro Workspace, keine Features, die dem Open-Source-Kern vorenthalten werden.",
  enterpriseCta: "Open Source vs. Enterprise",
} as const;

const deClosing = {
  titleLead: "Richten Sie es auf etwas",
  titleHighlight: "Echtes.",
  body: "Der schnellste ehrliche Test ist ein System, das Sie bereits betreiben. Installieren Sie es, binden Sie eine Quelle an und sehen Sie, was der Ermittler zutage fördert.",
  ctaShowcase: "Live-Showcase ausprobieren",
  linkSource: "Source auf GitHub",
  linkSources: "Unterstützte Quellen",
  linkDocs: "Dokumentation",
} as const;

const de: GetCopy = {
  hero: deHero,
  mascots: deMascots,
  quickstart: {
    marker: "Schnellstart",
    title: "Zwei Befehle. Zwei Wege zu betreiben.",
    lede: "Heute Nacht ein Docker-Image, derselbe Kern als Helm-Chart, wenn der Bestand wächst. Details und Anforderungen finden Sie unten.",
  },
  docker: deDocker,
  firstRun: deFirstRun,
  kubernetes: deKubernetes,
  which: deWhich,
  closing: deClosing,
};

export default de;
