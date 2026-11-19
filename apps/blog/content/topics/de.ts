import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const deChrome: TopicChrome = {
  home: "Start",
  chip: "Open-Source-Data-Governance",
  marks: {
    points: "So funktioniert es",
    detail: "Klar gesagt",
    compare: "Im Vergleich",
    notDo: "Was es nicht tut",
    run: "Ihr Zug",
    faq: "Klare Antworten",
    related: "Weiterlesen",
  },
  runTitle: "Noch heute auf Ihrem Rechner starten",
  runBody:
    "Ein Docker-Image mit Datenbank, Oberfläche und Workern. Keine Anmeldung; einloggen mit classifyre / classifyre. Ihre Daten bleiben bei Ihnen.",
  runDocs: "Einrichtung und Konfiguration",
  pilotTitle: "Oder mit einem Pilot beginnen",
  pilotBody:
    "Vier bis sechs Wochen auf Ihren Daten: 3 bis 5 Quellen, abgestimmte Erkennung, Maskierung aktiv, eine BI-Anbindung und ein Fund- und Zugriffsbericht. Fester Umfang, Festpreis.",
  pilotCta: "Über einen Pilot sprechen",
  relatedTitle: "Verwandte Themen",
  faqTitle: "Fragen",
  sourcesLabel: "Quellen",
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Immuta-Alternative",
  metaTitle: "Open-Source-Alternative zu Immuta, On-Premises",
  metaDescription:
    "Eine Open-Source-Alternative zu Immuta gesucht? Classifyre findet personenbezogene Daten, maskiert sie in der Abfrage und protokolliert jeden Zugriff, auf Ihren Servern.",
  keywords: [
    "Immuta Alternative",
    "Alternative zu Immuta",
    "Open Source Immuta",
    "Datenzugriffssteuerung Open Source",
    "dynamische Datenmaskierung Open Source",
  ],
  h1: "Eine Open-Source-Alternative zu Immuta",
  lede: "Immuta ist ein ausgereiftes kommerzielles Produkt, das Zugriffsrichtlinien in Cloud-Datenplattformen durchsetzt. Classifyre deckt dasselbe Feld anders ab: Open Source, selbst betrieben, mit Erkennung, Maskierung, Abfrage und Zugriffsprotokoll in einem Produkt.",
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
      body: "Apache-2.0, auch SSO, Rollen und das Gateway. Enterprise-Kunden zahlen für Umsetzung und Betreuung, nicht für Funktionen.",
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
        us: "Nur selbst betrieben: Docker, Kubernetes, OpenShift; läuft offline",
      },
      {
        aspect: "Wo Richtlinien greifen",
        them: "Nativ in angebundenen Plattformen wie Snowflake und Databricks",
        us: "In Classifyres eigenen Abfrage-Jobs, neben den Daten",
      },
      {
        aspect: "Personenbezogene Daten finden",
        them: "Erkennung sensibler Daten für angebundene Plattformen",
        us: "41 PII-Arten, 27 Secret-Muster, eigene Detektoren, über 40+ Quelltypen inkl. Wikis, Tickets und Dateien",
      },
      {
        aspect: "BI-Zugriff",
        them: "Über die verwaltete Plattform",
        us: "PostgreSQL-Gateway mit persönlichen, befristeten Verbindungen",
      },
      { aspect: "Preis", them: "Lizenz", us: "Kostenlos; Enterprise sind Leistungen und SLA" },
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
      a: "Nicht automatisch. Die meisten Teams beginnen mit der Klassifizierung, die personenbezogene Daten standardmäßig maskiert, und geben Klartext dort frei, wo er nötig ist. Ein Enterprise-Pilot umfasst die Abbildung Ihres bestehenden Zugriffsmodells.",
    },
  ],
  related: ["unity-catalog-alternative"],
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
        us: "Selbst betrieben: Docker, Kubernetes, OpenShift; läuft offline",
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
  related: ["immuta-alternative"],
};

export const deTopics: Record<TopicId, TopicCopy> = {
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
