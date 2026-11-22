import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const deChrome: TopicChrome = {
  home: "Start",
  chip: "Open-Source Data Governance",
  marks: {
    points: "So funktioniert es",
    detail: "In der Praxis",
    compare: "Im Vergleich",
    notDo: "Abgrenzung",
    run: "Betrieb & Pilot",
    faq: "Häufige Fragen",
    related: "Weiterlesen",
  },
  runTitle: "Auf Ihrer eigenen Infrastruktur betreiben",
  runBody:
    "Lokal mit einem Docker-Container testen oder mit Helm produktiv auf Kubernetes und OpenShift betreiben. 100 % Open Source (Apache-2.0) – Ihre Daten bleiben in Ihrem Netz.",
  runDocs: "Installationsleitfaden",
  pilotTitle: "Individuelle Einführung geplant?",
  pilotBody:
    "Arbeiten Sie direkt mit unserem Engineering-Team in einem 4–6-wöchigen Piloten: IAM- und Verzeichnisgruppen anbinden, Zeilenfilter und Spaltenmasken auf prioritären Quellen setzen, Power BI und Excel verbinden und erste Delta- oder Live-Datenprodukte veröffentlichen.",
  pilotCta: "Mit unserem Team sprechen",
  relatedTitle: "Verwandte Themen",
  faqTitle: "Fragen",
  sourcesLabel: "Quellen",
};

const accessGovernance: TopicCopy = {
  id: "data-access-governance",
  name: "Berechtigungskonzept umsetzen",
  metaTitle: "Berechtigungskonzept umsetzen: Datenzugriff steuern",
  metaDescription:
    "Berechtigungskonzept auf 40+ Systemen durchsetzen: AD-Gruppen bestimmen Tabellen, Zeilen und Spalten, Maskierung standardmäßig, jeder Zugriff protokolliert.",
  keywords: [
    "Berechtigungskonzept",
    "Berechtigungskonzept umsetzen",
    "Rollen- und Rechtekonzept",
    "Datenzugriff steuern",
    "Zugriffssteuerung",
    "Need-to-know-Prinzip",
    "Zeilenfilter",
    "Datenmaskierung",
  ],
  h1: "Berechtigungskonzept umsetzen: auf den Daten, nicht nur auf Papier",
  lede: "Ein Berechtigungskonzept legt fest, wer welche Daten sehen darf. Classifyre setzt es dort durch, wo die Daten gelesen werden: als eine kontrollierte Schicht über den Systemen, die Sie schon betreiben. AD-Gruppen bestimmen Tabellen, Zeilen und Spalten jeder Person, personenbezogene Daten bleiben maskiert, bis jemand freigegeben ist, und jeder Zugriff wird protokolliert.",
  demo: "access",
  demoCaption: "Verzeichnisgruppen auf Freigaben einer Tabelle abgebildet: Zeilen pro Bezirk, Klartext bis zu einem Datum.",
  mascot: "looking-at-you",
  mascotAlt: "Der Classifyre-Ermittler sieht Sie direkt an",
  pointsTitle: "So setzt Classifyre es um",
  points: [
    {
      title: "Gruppen aus Ihrem Verzeichnis",
      body: "Entra ID, Active Directory, Okta oder jeder OIDC- oder SAML-Anbieter, über den mitgelieferten Identity-Server. Zugriff geht immer an Gruppen: Wer im Verzeichnis die Abteilung wechselt, hat bei der nächsten Anmeldung den passenden Datenzugriff.",
      href: docs.directory,
      linkLabel: "Firmenverzeichnis anbinden",
    },
    {
      title: "Zeilen pro Gruppe",
      body: "Zeilenfilter zeigen jeder Gruppe nur die Zeilen, die eine Regel für sie auswählt, und ohne Regel keine. Ein Bezirk sieht seinen Bezirk; Owner und Stewards der Tabelle verwalten die Regeln.",
      href: docs.rowFilters,
      linkLabel: "Gefilterte Zeilen",
    },
    {
      title: "Spalten nach Klassifizierung maskiert",
      body: "Personenbezogene und sensible Spalten werden in der Abfrage maskiert, Secrets ausgeblendet. Klartext ist eine eigene Freigabe mit Ablaufdatum, und Workspace-Admins haben sie standardmäßig nicht.",
      href: docs.masking,
      linkLabel: "Maskierte und ausgeblendete Spalten",
    },
    {
      title: "Jeder Zugriff protokolliert",
      body: "Jeder Zugriff nennt Person, Tabelle und Kanal: SQL-Seite, Export, Power BI oder Excel über eine persönliche Verbindung oder ein KI-Agent über MCP, der als diese Person liest.",
      href: docs.whoMayQuery,
      linkLabel: "Wer was abfragen darf",
    },
  ],
  detail: {
    title: "Warum das Berechtigungskonzept bis zu den Daten reichen muss",
    paragraphs: [
      "Fast jede Organisation hat ein Berechtigungskonzept, ein Rollen- und Rechtekonzept, das festhält, welche Abteilung welche Daten sehen darf und warum. Die Daten lesen keine Dokumente. Jedes System hat eigene Logins und Rollen, also wird das Konzept von Hand durchgesetzt, ein Ticket und ein Export nach dem anderen, und hinterher kann niemand sagen, wer was hat.",
      "Classifyre schließt diese Lücke. Gruppen und Rollen kommen aus dem Verzeichnis, das Sie schon betreiben, die Regeln (Freigaben, Zeilenfilter, Masken, Ablaufdaten) liegen neben den Daten, und jede Abfrage läuft durch sie: in der App, über eine PostgreSQL-Verbindung aus Power BI oder Excel und für KI-Agenten. Das Zugriffsprotokoll ist der Nachweis, dass das Konzept gegolten hat: Nachvollziehbarkeit nach dem Need-to-know-Prinzip.",
      "Das unterstützt die DSGVO-Grundsätze der Datenminimierung und der Rechenschaftspflicht (Art. 5) sowie Datenschutz durch Technikgestaltung (Art. 25). Keine Software macht eine Organisation allein konform; Classifyre sorgt dafür, dass die Regeln durchgesetzt werden und der Nachweis aufgeschrieben ist.",
    ],
  },
  notDo: {
    title: "Was Classifyre nicht tut",
    body: "Classifyre regelt die Zugriffe, die über Classifyre laufen. Wer eine Datenbank oder Databricks direkt mit eigenen Zugangsdaten abfragt, folgt den Regeln dieses Systems, nicht denen von Classifyre. Ihren Identity-Provider ersetzt es auch nicht: Anmeldung und Gruppen bleiben dort, Classifyre folgt ihnen.",
  },
  faq: [
    {
      q: "Was ist ein Berechtigungskonzept?",
      a: "Ein Dokument, das festhält, welche Rollen und Gruppen auf welche Daten zugreifen dürfen, in welchem Umfang und mit welcher Begründung, nach dem Need-to-know-Prinzip. Die DSGVO verlangt, dass personenbezogene Daten nur so weit zugänglich sind, wie es der Zweck erfordert; das Berechtigungskonzept ist, wie eine Organisation das festlegt.",
    },
    {
      q: "Ersetzt Classifyre unser Berechtigungskonzept?",
      a: "Nein, es setzt es durch. Ihr Konzept entscheidet weiterhin, wer was sehen darf; Classifyre sorgt dafür, dass diese Entscheidung auf den Daten selbst gilt, bei jeder Abfrage und in jedem Werkzeug, und protokolliert jeden Zugriff als Nachweis.",
    },
    {
      q: "Müssen wir unsere AD-Gruppen in Classifyre neu anlegen?",
      a: "Nein. Binden Sie Ihr Verzeichnis an den Identity-Server an und bilden Sie die Gruppen mit Group-Mappern ab; Änderungen erreichen Classifyre bei der nächsten Anmeldung. Gruppen, die es nur für ein Projekt gibt, legen Sie in der Identity-Konsole von Hand an.",
    },
  ],
  related: ["immuta-alternative", "unity-catalog-alternative"],
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Immuta-Alternative",
  metaTitle: "Open-Source-Alternative zu Immuta, On-Premises",
  metaDescription:
    "Eine Open-Source-Alternative zu Immuta gesucht? Classifyre steuert den Zugriff nach Gruppe, Zeile und Spalte, maskiert in der Abfrage und protokolliert jeden Zugriff, auf Ihren Servern.",
  keywords: [
    "Immuta Alternative",
    "Alternative zu Immuta",
    "Open Source Immuta",
    "Datenzugriffssteuerung Open Source",
    "dynamische Datenmaskierung Open Source",
  ],
  h1: "Eine Open-Source-Alternative zu Immuta",
  lede: "Immuta ist ein ausgereiftes kommerzielles Produkt, das Zugriffsrichtlinien in Cloud-Datenplattformen durchsetzt. Classifyre deckt dasselbe Feld anders ab: Open Source, selbst betrieben, mit Zugriff nach Gruppen, Erkennung, Maskierung, Abfrage und Zugriffsprotokoll in einem Produkt.",
  demo: "mask",
  demoCaption: "Die Klassifizierung steuert die Masken, ohne dass eine Richtlinie geschrieben wird.",
  mascot: "looking-at-you",
  mascotAlt: "Der Classifyre-Ermittler sieht Sie direkt an",
  pointsTitle: "Worin sich Classifyre unterscheidet",
  points: [
    {
      title: "Erkennen und Maskieren sind ein Schritt",
      body: "Eine Spalte, in der personenbezogene Daten gefunden wurden, ist ab der nächsten Abfrage maskiert. Bevor der Schutz greift, muss keine Richtlinie geschrieben werden.",
    },
    {
      title: "Die Abfrage läuft in Classifyre",
      body: "Statt Richtlinien in jedes Warehouse zu schieben, führt Classifyre die Abfrage neben den Daten aus, mit angewendeten Masken, und liefert an SQL, Excel und Power BI.",
    },
    {
      title: "Alles ist Open Source",
      body: "Apache-2.0, auch SSO, Rollen und das Gateway. Wenn Sie Hilfe bei Umsetzung oder Betreuung brauchen, kontaktieren Sie uns: Jede Funktion ist schon Open Source.",
    },
  ],
  detail: {
    title: "Wann was passt",
    paragraphs: [
      "Liegen Ihre Daten schon in Snowflake oder Databricks und sollen Richtlinien dort nativ greifen, ist Immuta genau dafür gebaut und hat Jahre an Integrationen hinter sich.",
      "Sind Ihre Daten über On-Premises-Datenbanken, Dateiablagen und Lakehouse-Dateien verteilt, müssen sie auf Ihren Servern bleiben, oder bevorzugt die Beschaffung offenen Code, passt Classifyre besser.",
    ],
  },
  comparison: {
    title: "Classifyre und Immuta im Vergleich",
    asOf: "Stand November 2026, nach der öffentlichen Dokumentation der Anbieter.",
    columns: { aspect: "", them: "Immuta", us: "Classifyre" },
    rows: [
      { aspect: "Lizenz", them: "Kommerziell", us: "Apache-2.0, jede Funktion" },
      {
        aspect: "Betrieb",
        them: "Immuta SaaS oder selbst verwaltet",
        us: "Selbst betrieben auf Docker, Kubernetes & OpenShift – On-Premises, Private Cloud oder AWS/Azure/GCP; offline-fähig",
      },
      {
        aspect: "Wo Richtlinien greifen",
        them: "Nativ in angebundenen Cloud-Plattformen wie Snowflake und Databricks",
        us: "In Classifyres Abfrageschicht über Datenbanken, Iceberg, Delta, Parquet und geteilte Datenprodukte",
      },
      {
        aspect: "Sensible Daten erkennen",
        them: "Erkennung sensibler Daten für angebundene Plattformen",
        us: "Standard-PII & Secrets plus eigene Regex-, Python-, lokale CPU-KI- (GLiNER2) und LLM-Detektoren über 40+ Quellen",
      },
      {
        aspect: "BI & Datenprodukte",
        them: "Über die verwaltete Cloud-Plattform",
        us: "Persönliche, befristete PostgreSQL-/ODBC-Verbindungen für Power BI & Excel plus Datenanfragen & Delta-Datenprodukte",
      },
      { aspect: "Lizenzmodell", them: "Kommerzielle Lizenz", us: "100 % Open Source (Apache-2.0); individuelle Unterstützung auf Anfrage" },
    ],
    note: "Immutas Funktionen ändern sich oft; den aktuellen Stand finden Sie in deren Dokumentation. Korrekturen gerne an contact@classifyre.com.",
    sources: [
      {
        label: "Immuta: Deployment-Optionen",
        href: "https://documentation.immuta.com/configure-integration/deployment-options/",
      },
      { label: "Classifyre: Daten abfragen", href: docs.dataQuery },
    ],
  },
  notDo: {
    title: "Was Classifyre nicht tut",
    body: "Classifyre schiebt keine Maskierungsrichtlinien in Snowflake oder Databricks für Abfragen, die an ihm vorbeigehen. Wer diese Plattformen direkt abfragt, unterliegt deren eigenen Regeln.",
  },
  faq: [
    {
      q: "Kann ich Richtlinien aus Immuta übernehmen?",
      a: "Nicht automatisch. Die meisten Teams beginnen mit der Klassifizierung, die personenbezogene Daten standardmäßig maskiert, und geben Klartext dort frei, wo er nötig ist. Ein Pilot umfasst die Abbildung Ihres bestehenden Zugriffsmodells.",
    },
  ],
  related: ["data-access-governance", "unity-catalog-alternative"],
};

const unity: TopicCopy = {
  id: "unity-catalog-alternative",
  name: "Unity-Catalog-Alternative",
  metaTitle: "Alternative zu Unity Catalog über Databricks hinaus",
  metaDescription:
    "Data Governance über Databricks hinaus: Klassifizierung, Spaltenmasken, Zeilenfilter und Protokoll jedes Zugriffs über Datenbanken, Lakehouses und Dateien.",
  keywords: [
    "Unity Catalog Alternative",
    "Alternative zu Unity Catalog",
    "Data Governance über Databricks hinaus",
    "Spaltenmaskierung über Quellen",
    "Lakehouse Governance",
  ],
  h1: "Governance über Databricks hinaus: eine Alternative zu Unity Catalog",
  lede: "Unity Catalog regelt das Databricks-Lakehouse gut. Classifyre regelt auch alles drumherum: On-Premises-Datenbanken, Dateiablagen, SaaS-Werkzeuge und Lakehouse-Dateien, mit denselben Masken, ob in SQL, Excel oder Power BI abgefragt wird.",
  demo: "query",
  demoCaption: "Eine Databricks-Delta-Tabelle mit einer On-Premises-Datenbank verknüpft, Masken aktiv.",
  mascot: "looking-around",
  mascotAlt: "Der Classifyre-Ermittler schaut sich um",
  pointsTitle: "Worin sich Classifyre unterscheidet",
  points: [
    {
      title: "Über Systeme, nicht eine Plattform",
      body: "40+ Quelltypen unter einem Satz von Freigaben, Masken und Protokoll, die Databricks-Delta-Tabellen eingeschlossen.",
    },
    {
      title: "Masken ohne Funktionen zu schreiben",
      body: "Masken folgen der Klassifizierung: geschwärzt, letzte vier, gehasht, leer oder ausgeblendet, gewählt in einem Dialog statt als SQL-Funktion pro Spalte.",
    },
    {
      title: "Erkennung inklusive",
      body: "Die personenbezogenen Daten findet dasselbe Produkt, das sie maskiert, in Tabellen und in Dokumenten.",
    },
  ],
  detail: {
    title: "Wann was passt",
    paragraphs: [
      "Leben Ihre Daten und Nutzer in Databricks, ist Unity Catalog die natürliche Governance-Schicht, und seine Zeilenfilter und Spaltenmasken greifen in Databricks-Compute.",
      "Ist Ihre Landschaft breiter als eine Plattform oder muss sie auf Ihren Servern laufen, gibt Classifyre Ihnen eine Governance-Schicht über alles und liest Databricks-Delta-Tabellen als eine Quelle unter vielen.",
    ],
  },
  comparison: {
    title: "Classifyre und Unity Catalog im Vergleich",
    asOf: "Stand November 2026, nach der öffentlichen Dokumentation der Projekte.",
    columns: { aspect: "", them: "Unity Catalog (Databricks)", us: "Classifyre" },
    rows: [
      {
        aspect: "Lizenz",
        them: "Teil der Databricks-Plattform; ein Open-Source-Server (LF AI & Data) bietet eine Teilmenge",
        us: "Apache-2.0, jede Funktion",
      },
      {
        aspect: "Reichweite",
        them: "Das Databricks-Lakehouse und Engines, die seine APIs nutzen",
        us: "40+ Quelltypen: Datenbanken, Lakehouses, Dateien, SaaS-Werkzeuge",
      },
      {
        aspect: "Spaltenmasken",
        them: "SQL-Funktionen pro Spalte oder tag-basierte ABAC-Richtlinien",
        us: "Pro Spalte oder nach Klassifizierung: schwärzen, letzte vier, hashen, leeren, ausblenden",
      },
      {
        aspect: "Zeilenfilter",
        them: "SQL-Funktionen pro Tabelle oder ABAC-Richtlinien",
        us: "Pro Gruppe, im Zweifel gesperrt",
      },
      {
        aspect: "Personenbezogene Daten finden",
        them: "Datenklassifizierung für Databricks-Tabellen",
        us: "Detektoren über Tabellen und Dokumente, mit Score und Begründung",
      },
      {
        aspect: "Betrieb",
        them: "Databricks-Clouddienst",
        us: "Selbst betrieben auf Docker, Kubernetes & OpenShift – On-Premises, Private Cloud oder AWS/Azure/GCP; offline-fähig",
      },
    ],
    note: "Databricks ändert häufig; den aktuellen Stand finden Sie in deren Dokumentation. Korrekturen gerne an contact@classifyre.com.",
    sources: [
      {
        label: "Databricks: Zeilenfilter und Spaltenmasken",
        href: "https://docs.databricks.com/en/data-governance/unity-catalog/filters-and-masks/",
      },
      {
        label: "Databricks: Unity Catalog als Open Source",
        href: "https://www.databricks.com/blog/open-sourcing-unity-catalog",
      },
      { label: "Classifyre: Lakehouse-Quellen", href: docs.lakehouse },
    ],
  },
  notDo: {
    title: "Was Classifyre nicht tut",
    body: "Classifyre setzt seine Masken nicht in Databricks-Compute durch. Notebooks und Jobs, die Delta-Tabellen direkt in Databricks lesen, folgen den Regeln von Unity Catalog, nicht denen von Classifyre.",
  },
  faq: [
    {
      q: "Kann Classifyre Unity-Catalog-Tabellen lesen?",
      a: "Ja. Databricks-Delta-Tabellen sind als Quelle abfragbar, und Iceberg-Kataloge, einschließlich des REST-Endpunkts von Unity Catalog, lassen sich scannen.",
    },
  ],
  related: ["data-access-governance", "immuta-alternative"],
};

export const deTopics: Record<TopicId, TopicCopy> = {
  "data-access-governance": accessGovernance,
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
