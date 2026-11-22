import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const deChrome: TopicChrome = {
  home: "Start",
  chip: "Open-Source Data Governance",
  marks: {
    points: "So funktioniert es",
    detail: "In der Praxis",
    architecture: "Architekturvergleich",
    scorecard: "Funktionsvergleich",
    tradeoffs: "Stärken & ehrliche Grenzen",
    decision: "Entscheidungshilfe",
    compare: "Detailvergleich",
    notDo: "Abgrenzung",
    run: "Betrieb & Zusammenarbeit",
    faq: "Häufige Fragen",
    related: "Weiterlesen",
  },
  runTitle: "Auf Ihrer eigenen Infrastruktur betreiben",
  runBody:
    "Lokal mit einem Docker-Container evaluieren oder mit Helm produktiv auf Kubernetes und OpenShift betreiben. 100 % Open Source (Apache-2.0) – Ihre Daten bleiben in Ihrem Netz.",
  runDocs: "Installationsleitfaden",
  tailoringTitle: "Individuelle Anpassung für Ihre Umgebung?",
  tailoringBody:
    "Arbeiten Sie direkt mit unserem Engineering-Team zu individuell vereinbartem Umfang – für IAM-Integration, Sicherheitsarchitektur, eigene Quellen, Delta-Datenprodukte oder maßgeschneiderte Detektoren und KI-Modelle.",
  tailoringCta: "Mit unserem Team sprechen",
  relatedTitle: "Weitere Vergleiche & Leitfäden",
  faqTitle: "Häufige Fragen",
  sourcesLabel: "Quellen",
};

const accessGovernance: TopicCopy = {
  id: "data-access-governance",
  name: "Berechtigungskonzept umsetzen",
  metaTitle: "Berechtigungskonzept umsetzen: Open-Source Data Governance",
  metaDescription:
    "Setzen Sie Ihr Berechtigungskonzept auf 40+ Systemen durch: AD-Gruppen, Zeilenfilter, mehrstufige Spaltenmaskierung, SQL/BI-Zugriff und lückenlose Protokollierung unter Apache-2.0.",
  keywords: [
    "Berechtigungskonzept umsetzen",
    "Datenzugriff steuern",
    "Data Governance Open Source",
    "Rollen- und Rechtekonzept",
    "Zeilenfilter",
    "Datenmaskierung Open Source",
    "On-Premises Data Governance",
  ],
  h1: "Berechtigungskonzept umsetzen: auf den Daten, nicht nur auf Papier",
  lede: "Ein Berechtigungskonzept legt fest, wer welche Daten sehen darf – und erst die technische Durchsetzung macht es wirksam. Classifyre integriert sich mit Ihren bestehenden Datenbanken, Lakehouses und Ihrem Verzeichnisdienst, um Gruppenrechte, Zeilenfilter und Spaltenmaskierung für SQL, Power BI, Excel, ODBC und Datenprodukte durchzusetzen.",
  demo: "access",
  demoCaption: "Verzeichnisgruppen auf Freigaben abgebildet: Regionen sehen eigene Zeilen, Finanzen erhalten befristeten Klartext.",
  mascot: "looking-at-you",
  mascotAlt: "Classifyre Berechtigungskonzept Übersicht",
  pointsTitle: "So setzt Classifyre Ihr Berechtigungskonzept durch",
  points: [
    {
      title: "Gruppen direkt aus Ihrem Verzeichnis",
      body: "Binden Sie Entra ID, Active Directory, Okta oder OIDC/SAML an. Berechtigungen gelten stets für Gruppen – wechselt jemand die Abteilung, passt sich der Zugriff bei der nächsten Anmeldung automatisch an.",
      href: docs.directory,
      linkLabel: "Firmenverzeichnis anbinden",
    },
    {
      title: "Zeilenfilter pro Gruppe",
      body: "Zeilenfilter zeigen jeder Gruppe ausschließlich die Zeilen ihrer Regel (z. B. Region, Bezirk oder Gesellschaft) und sperren im Zweifel geschlossen.",
      href: docs.rowFilters,
      linkLabel: "Gefilterte Zeilen",
    },
    {
      title: "Mehrstufige Spaltenmaskierung",
      body: "Personenbezogene und sensible Spalten werden geschwärzt, auf die letzten vier Stellen gekürzt, deterministisch gehasht (DSGVO-Pseudonymisierung), geleert oder verborgen – auf Originaltabellen und geteilten Datenprodukten.",
      href: docs.masking,
      linkLabel: "Maskierte und ausgeblendete Spalten",
    },
    {
      title: "Lückenloses Audit-Protokoll",
      body: "Jeder Lesezugriff protokolliert Person, Tabelle oder Datenprodukt, Zeitpunkt und Kanal: SQL-Editor, Export, Power BI, Excel, ODBC oder KI-Agent über MCP.",
      href: docs.whoMayQuery,
      linkLabel: "Wer was abfragen darf",
    },
  ],
  detail: {
    title: "Die Lücke zwischen Dokument und produktiver Datenbank schließen",
    paragraphs: [
      "Fast jede Organisation besitzt ein dokumentiertes Rollen- und Rechtekonzept. In der Praxis liegen die Daten jedoch verteilt über relationale Datenbanken, Iceberg- und Delta-Lakehouses sowie Dateiablagen – jedes System mit eigenen Logins. Zugriff wird per Ticket und CSV-Export gelöst, und im Audit lässt sich kaum belegen, wer welche Daten gelesen hat.",
      "Classifyre schließt diese Lücke ohne Systemwechsel. Gruppen bleiben in Ihrem Verzeichnisdienst, Detektoren klassifizieren sensible und fachspezifische Spalten direkt an der Quelle, und jede Abfrage in Power BI, Excel, SQL oder über ein geteiltes Delta-Datenprodukt durchläuft dieselben Zeilenfilter, Masken und Protokolle.",
      "Das unterstützt die DSGVO-Grundsätze Datenminimierung, Rechenschaftspflicht (Art. 5) und Datenschutz durch Technikgestaltung (Art. 25) sowie NIS2 und DORA. Keine Software ersetzt organisatorische Verantwortung – aber technische Durchsetzung und vollständige Protokolle machen Compliance belegbar.",
    ],
  },
  notDo: {
    title: "Abgrenzung",
    body: "Classifyre regelt alle Zugriffe, die über Classifyre laufen (SQL-Arbeitsbereich, Power BI/Excel/ODBC-Gateway, Exporte, geteilte Datenprodukte und MCP). Wer Datenbanken oder Cloud-Warehouses direkt mit eigenen Zugangsdaten abfragt, unterliegt den Regeln des jeweiligen Zielsystems. Classifyre ersetzt weder Ihr IAM noch Ihre ETL-Tools.",
  },
  faq: [
    {
      q: "Was ist ein technisch durchgesetztes Berechtigungskonzept?",
      a: "Statt Zugriffsregeln nur im Wiki zu dokumentieren, werden Gruppenrechte, Zeilenfilter, Spaltenmasken und Freigabeprozesse direkt bei jeder Abfrage erzwungen und revisionssicher protokolliert.",
    },
    {
      q: "Unterstützt Classifyre RBAC und ABAC?",
      a: "Ja. Rechte werden an Verzeichnisgruppen und Rollen vergeben (RBAC), während Zeilenregeln und Spaltenklassifizierungen dynamisch bestimmen, welche Zeilen sichtbar und wie Spalten maskiert sind (ABAC).",
    },
    {
      q: "Müssen Benutzer in Classifyre doppelt gepflegt werden?",
      a: "Nein. Verbinden Sie Entra ID, Active Directory, Okta oder OIDC/SAML, um Gruppen automatisch zu synchronisieren. Änderungen greifen bei der nächsten Anmeldung.",
    },
  ],
  related: ["immuta-alternative", "unity-catalog-alternative"],
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Classifyre vs. Immuta",
  metaTitle: "Classifyre vs. Immuta: Ehrlicher Open-Source-Vergleich (2026)",
  metaDescription:
    "Objektiver Architekturvergleich zwischen Classifyre und Immuta: Cloud-Warehouse-Pushdown vs. quellübergreifende Open-Source Data Governance, Stärken, Grenzen und Entscheidungshilfe.",
  keywords: [
    "Immuta Alternative",
    "Classifyre vs Immuta",
    "Open Source Immuta Alternative",
    "Data Governance Open Source",
    "dynamische Datenmaskierung Open Source",
    "On-Premises Data Governance",
  ],
  h1: "Classifyre vs. Immuta: ein ehrlicher Architekturvergleich",
  lede: "Immuta ist eine etablierte kommerzielle Plattform, die Zugriffsrichtlinien nativ in Cloud-Data-Warehouses wie Snowflake und Databricks durchsetzt. Classifyre ist eine 100 % Open-Source-Plattform (Apache-2.0) für den Eigenbetrieb, die On-Premises-Datenbanken, Lakehouses (Iceberg, Delta, Parquet), Dateien und BI-Werkzeuge unter einer Schicht vereint. Beide lösen echte Probleme – mit klar unterschiedlichen Stärken und Grenzen.",
  demo: "mask",
  demoCaption: "Classifyre klassifiziert Spalten direkt an der Quelle und wendet Zeilenfilter sowie mehrstufige Masken pro Gruppe an.",
  mascot: "looking-at-you",
  mascotAlt: "Classifyre vs. Immuta Vergleich",
  pointsTitle: "Zentrale Architekturunterschiede",
  points: [
    {
      title: "Quellübergreifende Abfrageschicht vs. Warehouse-Pushdown",
      body: "Immuta übersetzt Richtlinien in native Regeln innerhalb unterstützter Cloud-Plattformen (Snowflake, Databricks, Redshift, BigQuery). Classifyre setzt Zeilenfilter und Spaltenmasken in der eigenen Abfrageschicht über 40+ heterogene Quellen durch – inklusive On-Premises PostgreSQL, MySQL, ODBC, Parquet/Iceberg/Delta und geteilter Datenprodukte.",
      href: docs.dataQuery,
      linkLabel: "So funktionieren Classifyre-Abfragen",
    },
    {
      title: "Integrierte flexible Detektoren vs. Cloud-Plattform-Discovery",
      body: "Classifyre kombiniert fertige PII- und Secret-Pakete mit eigenen Geschäftsdetektoren (Regex, Python-Code, lokale CPU-KI wie GLiNER2 und LLMs) über Tabellen und unstrukturierte Dokumente hinweg – und steuert damit die Maskierung automatisch.",
      href: docs.detectors,
      linkLabel: "Detektoren ansehen",
    },
    {
      title: "100 % Apache-2.0 Open Source vs. kommerzielle SaaS-Lizenz",
      body: "Alle Funktionen in Classifyre – SSO, Rollen, Zeilenfilter, dynamische Maskierung, SQL/BI-Gateway, Datenanfragen, Datenprodukte und Audit-Log – sind Apache-2.0 ohne Nutzerlizenzen. Immuta erfordert einen kommerziellen Lizenzvertrag.",
      href: docs.deployment,
      linkLabel: "Selbst betriebenes Deployment",
    },
    {
      title: "Integriertes BI-Gateway & Datenprodukt-Anfragen",
      body: "Classifyre bietet persönliche, befristete PostgreSQL-/ODBC-Verbindungen für Power BI, Excel und Tableau sowie einen Anfrageprozess in Alltagssprache für neue Live- oder Delta-Datenprodukte.",
      href: docs.sqlConnections,
      linkLabel: "SQL- & BI-Verbindungen",
    },
  ],
  detail: {
    title: "Der Kern-Trade-off: Nativer Cloud-Pushdown vs. universelle Open-Source-Schicht",
    paragraphs: [
      "Die Wahl zwischen Immuta und Classifyre hängt vor allem davon ab, wo Ihre Daten liegen und wie Teams darauf zugreifen. Immutas größte Stärke ist die tiefe native Integration in große Cloud-Datenplattformen: Wenn 95 % Ihrer Analyse-Workloads in Snowflake und Databricks laufen und Data Scientists dort direkt Spark- oder SQL-Jobs ausführen, erzwingt Immutas Pushdown Richtlinien ohne zusätzlichen Abfrage-Hop.",
      "Classifyre ist für die Realität gebaut, die die meisten europäischen und internationalen Unternehmen sowie Behörden vorfinden: Daten verteilt über On-Premises-Datenbanken (PostgreSQL, MySQL, Oracle/SQL Server via ODBC), S3-/Azure-/GCS-Buckets mit Parquet, Iceberg und Delta, Databricks sowie Wikis und Dateien – oft verbunden mit strengen Anforderungen an Datensouveränität, Kubernetes/OpenShift und Open-Source-Beschaffung.",
      "Beide Ansätze haben klare Grenzen. Da Classifyre keine Policies in die interne Compute-Engine von Snowflake oder Databricks schiebt, gelten für direkte Warehouse-Logins außerhalb von Classifyre die dortigen Rechte. Umgekehrt vereinheitlicht Immuta weder On-Premises-Datenbanken, rohe Parquet-/Iceberg-Dateien und unstrukturierte Wikis noch lässt es sich lizenzfrei als Open Source betreiben.",
    ],
  },
  comparison: {
    title: "Classifyre vs. Immuta: Technischer Vergleich",
    asOf: "Stand November 2026 nach öffentlicher Herstellerdokumentation.",
    columns: { aspect: "Kriterium", them: "Immuta", us: "Classifyre" },
    architecture: {
      title: "Wie die Durchsetzung technisch funktioniert",
      lede: "Immuta schiebt Richtlinien in unterstützte Cloud-Warehouses. Classifyre setzt Regeln in einer selbst betriebenen Governance- und Abfrageschicht über die gesamte Datenlandschaft durch.",
      them: {
        name: "Immuta",
        badge: "Nativer Cloud-Pushdown · Kommerziell",
        flow: [
          { step: "01 · Richtlinien-Design", detail: "Zentrale ABAC/RBAC-Richtlinien in Immuta SaaS oder Self-Managed Control Plane" },
          { step: "02 · Native Übersetzung", detail: "Richtlinien werden in Snowflake, Databricks, Redshift oder BigQuery ausgespielt" },
          { step: "03 · Warehouse-Ausführung", detail: "Nutzer fragen direkt das Cloud-Warehouse ab; dieses wendet Masken & Filter an" },
        ],
        takeaway: "Optimal, wenn Workloads nativ innerhalb unterstützter Cloud-Warehouses (Snowflake, Databricks) ohne zusätzlichen Hop laufen.",
      },
      us: {
        name: "Classifyre",
        badge: "Quellübergreifende Governance-Schicht · Apache-2.0",
        flow: [
          { step: "01 · Verbinden & klassifizieren", detail: "Liest 40+ On-Prem-DBs, Iceberg/Delta/Parquet-Lakes, Buckets und eigene Quellen direkt an der Quelle" },
          { step: "02 · Gruppenrechte & Masken", detail: "Verzeichnisgruppen (Entra ID, AD, Okta) steuern Zeilenfilter, Spaltenmasken und Datenprodukte" },
          { step: "03 · Kontrollierte Nutzung", detail: "Abfragen über SQL, Power BI, Excel, ODBC, MCP oder Delta-Datenprodukte – jeder Zugriff protokolliert" },
        ],
        takeaway: "Optimal bei heterogenen On-Prem- und Cloud-Quellen, Open-Source-/Souveränitätsanforderungen sowie einheitlicher BI- und Datenprodukt-Governance.",
      },
    },
    scorecard: {
      title: "Funktionsvergleich auf einen Blick",
      lede: "Eine objektive Einordnung über acht Architekturdimensionen – inklusive der Bereiche, in denen Immuta stärker ist.",
      items: [
        {
          dimension: "Open-Source-Transparenz & keine Lizenzbindung",
          them: { level: "none", label: "Closed Source · kommerziell" },
          us: { level: "native", label: "100 % Apache-2.0" },
        },
        {
          dimension: "Nativer Policy-Pushdown in Snowflake- / Databricks-Compute",
          them: { level: "native", label: "Nativer Pushdown" },
          us: { level: "none", label: "Nur über Classifyre-Zugriff" },
        },
        {
          dimension: "Heterogene & On-Prem-Quellen (Postgres, MySQL, ODBC, Iceberg, Dateien)",
          them: { level: "partial", label: "Fokus Cloud-Warehouses" },
          us: { level: "native", label: "40+ & eigene Konnektoren" },
        },
        {
          dimension: "Dynamische Spaltenmaskierung & Zeilenfilter",
          them: { level: "native", label: "Ausgereiftes ABAC & Masking" },
          us: { level: "native", label: "5 Maskenarten + Zeilenfilter" },
        },
        {
          dimension: "Standard- + eigene KI/ML/Regex/Python-Detektoren (Tabellen & Dokumente)",
          them: { level: "supported", label: "Cloud-Plattform-Discovery" },
          us: { level: "native", label: "PII, Secrets, lokale KI & LLM" },
        },
        {
          dimension: "Power-BI-, Excel- & ODBC-Gateway ohne geteilte Passwörter",
          them: { level: "partial", label: "Über das jeweilige Warehouse" },
          us: { level: "native", label: "Persönlicher TLS-Endpunkt" },
        },
        {
          dimension: "Datenanfragen in Alltagssprache & geteilte Datenprodukte",
          them: { level: "supported", label: "Marketplace / Zugriffs-Workflows" },
          us: { level: "native", label: "Anfragen + Live- & Delta-Shares" },
        },
        {
          dimension: "Air-Gapped, On-Premises & OpenShift / Kubernetes Eigenbetrieb",
          them: { level: "partial", label: "SaaS-Fokus, Enterprise Self-Managed" },
          us: { level: "native", label: "Docker, K8s & OpenShift offline" },
        },
      ],
    },
    tradeoffs: {
      title: "Stärken und ehrliche Grenzen – auf beiden Seiten",
      lede: "Gute Architekturentscheidungen brauchen Klarheit darüber, was jedes System stark macht – und wo seine Grenzen liegen.",
      themPros: {
        heading: "Wo Immuta stark ist",
        items: [
          "Tiefer nativer Policy-Pushdown in Snowflake, Databricks, Redshift, Starburst und BigQuery – wirksam auch bei direkten Notebooks und Warehouse-Abfragen.",
          "Jahrelange Reife bei ABAC-Richtlinien, zweckgebundenen Zugriffen und großen Cloud-Warehouse-Umgebungen.",
          "Managed-SaaS-Angebot reduziert eigenen Betriebsaufwand für Teams, die vollständig auf US-Cloud-Datenplattformen setzen.",
        ],
      },
      themCons: {
        heading: "Wo Immuta an Grenzen stößt",
        items: [
          "Proprietäre, geschlossene Software mit hohen kommerziellen Lizenzkosten und Herstellerbindung.",
          "Stark auf große Cloud-Datenplattformen fokussiert; weniger geeignet für heterogene On-Premises-Datenbanken, rohe Parquet-/Iceberg-Dateien, Wikis oder Air-Gapped-Netze.",
          "Kein einheitliches quellübergreifendes SQL-/BI-Gateway und keine eigene Pipeline für lokale CPU-KI- oder Python-Detektoren auf unstrukturierten Daten.",
        ],
      },
      usPros: {
        heading: "Wo Classifyre stark ist",
        items: [
          "100 % Open Source unter Apache-2.0 – prüfbarer Code, keine Lizenzkosten pro Nutzer und keine gesperrten Enterprise-Stufen.",
          "Vereint 40+ heterogene Quellen (On-Prem-DBs, Iceberg, Delta, Parquet, Databricks, S3/Azure/GCS, Wikis, eigene Systeme) unter einer Maskierungs-, Zeilenfilter- und Audit-Schicht.",
          "Kombiniert fertige PII-/Secret-Pakete mit eigenen Geschäftsdetektoren (Regex, Python, lokale CPU-KI wie GLiNER2, LLMs), persönlichen Power-BI-/Excel-/ODBC-Verbindungen und fachlichen Datenprodukt-Anfragen.",
          "Läuft überall – Docker, Kubernetes, OpenShift, abgeschottet On-Premises oder in Ihrer eigenen Cloud – bei voller Datensouveränität.",
        ],
      },
      usCons: {
        heading: "Ehrliche Grenzen von Classifyre",
        items: [
          "Schiebt keine Maskierungsrichtlinien in interne Snowflake- oder Databricks-Compute-Engines; direkte Zugriffe an Classifyre vorbei folgen den Rechten des Zielsystems.",
          "Quellübergreifendes SQL läuft in Classifyre-Abfrage-Workern (DuckDB) – sehr stark für zig Millionen Zeilen, aber kein Ersatz für Petabyte-Spark- oder Snowflake-ETL-Cluster.",
          "Jüngeres Projekt mit kleinerem Partner-Ökosystem als ein seit Jahren etablierter kommerzieller Anbieter.",
        ],
      },
    },
    chooseWhen: {
      title: "Entscheidungshilfe: Immuta oder Classifyre?",
      them: {
        heading: "Wählen Sie Immuta, wenn …",
        items: [
          "nahezu alle analytischen Daten bereits in Snowflake, Databricks oder BigQuery liegen.",
          "Nutzer direkt in diesen Cloud-Plattformen umfangreiche Notebooks oder Compute-Jobs mit zentralem Policy-Pushdown ausführen müssen.",
          "Sie einen kommerziellen SaaS-Anbieter gegenüber selbst betriebener Open-Source-Software bevorzugen.",
        ],
      },
      us: {
        heading: "Wählen Sie Classifyre, wenn …",
        items: [
          "Ihre Daten über On-Premises-Datenbanken, Iceberg-/Delta-/Parquet-Lakes, Object Storage und SaaS-Systeme verteilt sind.",
          "Sie 100 % Open Source (Apache-2.0), keine Nutzerlizenzen sowie volle Datensouveränität auf Kubernetes, OpenShift oder On-Premises verlangen.",
          "Sie Erkennung, eigene Detektoren, mehrstufige Maskierung, persönlichen Power-BI-/Excel-/ODBC-Zugriff und Datenprodukte in einer Plattform suchen.",
        ],
      },
    },
    rows: [
      { aspect: "Lizenz", them: "Kommerziell proprietär", us: "Apache-2.0 Open Source (alle Funktionen enthalten)" },
      {
        aspect: "Betriebsmodell",
        them: "Immuta SaaS oder kommerziell Self-Managed",
        us: "Eigenbetrieb auf Docker, Kubernetes & OpenShift – On-Prem, Private Cloud oder AWS/Azure/GCP; offline-fähig",
      },
      {
        aspect: "Durchsetzung",
        them: "Nativer Policy-Pushdown in Snowflake, Databricks, Redshift, BigQuery, Starburst",
        us: "Abfragezeit-Durchsetzung in Classifyre über Datenbanken, Iceberg, Delta, Parquet, ODBC und Datenprodukte",
      },
      {
        aspect: "Unterstützte Quellen",
        them: "Große Cloud-Data-Warehouses & Lakehouses",
        us: "40+ strukturierte & unstrukturierte Quellen (PostgreSQL, MySQL, Databricks, ODBC, Iceberg, Delta, S3/Azure/GCS, Wikis) + eigene Plugins",
      },
      {
        aspect: "Erkennung & Klassifizierung",
        them: "Erkennung sensibler Daten in angebundenen Cloud-Plattformen",
        us: "Standard-PII & Secrets + eigene Regex-, Python-, lokale CPU-KI- (GLiNER2), Bild-/Textklassifikations- und LLM-Detektoren",
      },
      {
        aspect: "Maskierung & Zeilenfilter",
        them: "Dynamische Maskierung, Differential Privacy, ABAC-Zeilenfilter",
        us: "5 Maskenarten (geschwärzt, letzte vier, deterministischer Hash, leer, verborgen) + geschlossene Gruppen-Zeilenfilter",
      },
      {
        aspect: "BI- & SQL-Zugriff",
        them: "BI-Werkzeuge verbinden sich mit dem zugrundeliegenden Cloud-Warehouse",
        us: "Integriertes PostgreSQL-/ODBC-TLS-Gateway mit persönlichen, befristeten Verbindungen für Power BI, Excel, Tableau & MCP",
      },
      {
        aspect: "Datenprodukte & Teilen",
        them: "Marketplace-Zugriffsprozesse auf angebundenen Plattformen",
        us: "Datenanfragen in Alltagssprache, Owner-Freigabe und Live- oder Delta-Datenprodukte mit vererbter Masken-Untergrenze",
      },
      {
        aspect: "Kosten & Unterstützung",
        them: "Kommerzielle Enterprise-Subskription",
        us: "Kostenloses Apache-2.0 Open Source; individuelle Engineering-Unterstützung nach Vereinbarung",
      },
    ],
    note: "Herstellerfunktionen ändern sich laufend; prüfen Sie den aktuellen Stand in der offiziellen Immuta-Dokumentation. Fachliche Korrekturen gerne an contact@classifyre.com.",
    sources: [
      {
        label: "Immuta: Deployment-Optionen",
        href: "https://documentation.immuta.com/configure-integration/deployment-options/",
      },
      {
        label: "Immuta: Unterstützte Datenplattformen",
        href: "https://documentation.immuta.com/configure-integration/data-platforms/",
      },
      {
        label: "Classifyre: SQL, Maskierung & geteilte Datasets",
        href: docs.dataQuery,
      },
      {
        label: "Classifyre: Detektor-Referenz",
        href: docs.detectors,
      },
    ],
  },
  notDo: {
    title: "Was Classifyre nicht tut",
    body: "Classifyre schiebt keine Maskierungsrichtlinien in interne Snowflake-, Redshift- oder Databricks-Compute-Engines. Direkte Abfragen außerhalb von Classifyre unterliegen den jeweiligen Rechten dieser Plattformen.",
  },
  faq: [
    {
      q: "Kann Classifyre Immuta ersetzen, wenn wir On-Premises PostgreSQL, Iceberg und Power BI nutzen?",
      a: "Ja – genau dafür ist Classifyre gebaut. Es verbindet sich direkt mit On-Premises-Datenbanken, Iceberg-/Delta-/Parquet-Speichern und Ihrem Verzeichnis (Entra ID / AD / Okta), setzt Zeilenfilter und Spaltenmasken durch und bedient Power BI sowie Excel über persönliche Verbindungen ohne kommerzielle Lizenzkosten.",
    },
    {
      q: "Was, wenn wir Snowflake oder Databricks intensiv für Notebooks nutzen?",
      a: "Wenn Richtlinien direkt innerhalb von Snowflake-Worksheets oder Databricks-Spark-Notebooks greifen müssen, ist Immutas nativer Pushdown genau dafür ausgelegt. Classifyre passt besser, wenn Open-Source-Governance über heterogene Quellen, On-Premises-Daten, eigene Detektoren und BI-/Datenprodukt-Zugriff benötigt wird.",
    },
    {
      q: "Lassen sich bestehende Richtlinien aus Immuta übernehmen?",
      a: "Nicht per automatischem Ein-Klick-Export. In der Praxis starten Teams mit der automatischen Klassifizierung (die sensible Spalten standardmäßig maskiert), bilden Verzeichnisgruppen ab und setzen Zeilenfilter sowie Klartext-Freigaben. Auf Wunsch begleiten wir die Architekturabbildung individuell nach Vereinbarung.",
    },
    {
      q: "Wie vergleichen sich die Kosten bei 500+ Nutzern?",
      a: "Classifyre ist 100 % Apache-2.0 Open Source ohne Nutzer- oder Quellenlizenzen – es fallen nur Ihre eigenen Infrastrukturkosten (und optional vereinbarte individuelle Anpassungen) an. Immuta wird kommerziell lizenziert.",
    },
  ],
  related: ["data-access-governance", "unity-catalog-alternative"],
};

const unity: TopicCopy = {
  id: "unity-catalog-alternative",
  name: "Classifyre vs. Unity Catalog",
  metaTitle: "Classifyre vs. Unity Catalog: Ehrlicher Governance-Vergleich (2026)",
  metaDescription:
    "Objektiver Architekturvergleich zwischen Classifyre und Databricks Unity Catalog: Databricks-native Lakehouse-Governance vs. herstellerunabhängige Open-Source Data Governance.",
  keywords: [
    "Unity Catalog Alternative",
    "Classifyre vs Unity Catalog",
    "Open Source Unity Catalog Alternative",
    "Data Governance über Databricks hinaus",
    "Lakehouse Governance Open Source",
    "Iceberg Delta Governance",
  ],
  h1: "Classifyre vs. Unity Catalog: Governance in Databricks vs. über Ihre ganze Landschaft",
  lede: "Databricks Unity Catalog ist die natürliche, tief integrierte Governance-Schicht für Teams im Databricks Lakehouse. Classifyre ist eine herstellerunabhängige Open-Source-Plattform (Apache-2.0), die alles rund um und neben Databricks steuert – On-Premises-Datenbanken, Iceberg, Delta, Parquet, Object Storage, Wikis und BI-Werkzeuge – aus einer selbst betriebenen Oberfläche.",
  demo: "query",
  demoCaption: "Eine Databricks-Delta-Tabelle live verknüpft mit einer On-Premises PostgreSQL-Datenbank unter einheitlichen Masken.",
  mascot: "looking-around",
  mascotAlt: "Classifyre vs. Unity Catalog Vergleich",
  pointsTitle: "Wo sich die beiden Plattformen unterscheiden",
  points: [
    {
      title: "Gesamte Datenlandschaft vs. Databricks-Fokus",
      body: "Unity Catalog glänzt innerhalb von Databricks (und Engines mit seinen Katalog-APIs). Classifyre verwaltet 40+ Quelltypen – relationale Datenbanken, ODBC, Iceberg REST, rohe Parquet-/Delta-Buckets, Databricks Delta und Kollaborationstools – mit einheitlichen Gruppenregeln und Audit-Logs.",
      href: docs.lakehouse,
      linkLabel: "Lakehouse- & Quellen-Doku",
    },
    {
      title: "Klassifizierungsbasierte Maskierung vs. SQL-UDFs pro Spalte",
      body: "In Classifyre folgen Spaltenmasken (geschwärzt, letzte vier, deterministischer Hash, leer, verborgen) automatisch der Klassifizierung oder lassen sich direkt im Dialog anpassen – ohne Pflege zahlreicher SQL-Maskierungsfunktionen.",
      href: docs.masking,
      linkLabel: "So funktioniert Maskierung",
    },
    {
      title: "100 % Open Source vs. kommerzielle Plattform + OSS-Teilmenge",
      body: "Databricks hat einen Unity-Catalog-Server unter LF AI & Data veröffentlicht, während zentrale Enterprise-Funktionen (UI, automatische Klassifizierung, Lineage, Audit-Systemtabellen) im kommerziellen Databricks laufen. Classifyre liefert die gesamte Governance-Plattform unter Apache-2.0.",
      href: docs.deployment,
      linkLabel: "Open-Source-Betrieb",
    },
    {
      title: "Komplementär einsetzbar – kein striktes Entweder-oder",
      body: "Classifyre liest Databricks-Delta-Tabellen über External Data Access und scannt Iceberg-REST-Kataloge. So lässt sich Unity Catalog für Databricks-Notebooks behalten, während Classifyre quellübergreifendes BI, Maskierung und Nicht-Databricks-Systeme abdeckt.",
      href: docs.dataQuery,
      linkLabel: "Databricks-Integration",
    },
  ],
  detail: {
    title: "Einzel-Lakehouse-Tiefe vs. herstellerunabhängige Governance",
    paragraphs: [
      "Unity Catalog ist hervorragend, wenn Ihre gesamte Daten- und KI-Plattform auf Databricks läuft. Es regelt Delta-Tabellen, Spark- und Python-Notebooks, MLflow-Modelle, Volumes und SQL Warehouses nativ ohne Zusatzlatenz – inklusive automatischer Lineage und Delta Sharing.",
      "Reibung entsteht, sobald Daten nicht ausschließlich in Databricks liegen – was auf fast jedes Unternehmen und jede öffentliche Verwaltung zutrifft. Operative PostgreSQL-, MySQL-, Oracle- und SQL-Server-Datenbanken, Iceberg-Tabellen auf S3 oder eigenem MinIO, Dateiserver, Confluence-Wikis und Power-BI-/Excel-Nutzer liegen außerhalb von Databricks Compute.",
      "Classifyre löst diese breitere Aufgabe, ohne eine Migration in eine kommerzielle Cloud zu erzwingen. Es verbindet bestehende Datenbanken, Buckets, Iceberg-Kataloge und Databricks-Delta-Tabellen direkt an der Quelle, klassifiziert sensible und fachspezifische Daten automatisch, setzt Zeilenfilter und Spaltenmasken in SQL und BI durch und ermöglicht fachliche Datenprodukt-Anfragen – selbst betrieben auf Docker, Kubernetes oder OpenShift.",
    ],
  },
  comparison: {
    title: "Classifyre vs. Unity Catalog: Technischer Vergleich",
    asOf: "Stand November 2026 nach öffentlicher Dokumentation von Databricks und LF AI & Data Unity Catalog.",
    columns: { aspect: "Kriterium", them: "Unity Catalog (Databricks)", us: "Classifyre" },
    architecture: {
      title: "Wie beide Schichten in Ihrer Architektur sitzen",
      lede: "Unity Catalog ist der native Metastore und Sicherheitskern in Databricks. Classifyre ist eine unabhängige, selbst betriebene Governance-Schicht über Datenbanken, Lakehouses und BI-Werkzeuge.",
      them: {
        name: "Unity Catalog",
        badge: "Databricks-nativer Metastore · Cloud + OSS-Server",
        flow: [
          { step: "01 · Metastore & Katalog", detail: "Kataloge, Schemata, Tabellen, Volumes und KI/ML-Modelle zentral in Unity Catalog registriert" },
          { step: "02 · SQL-Funktionen & ABAC", detail: "Grants, SQL-Zeilenfilter-UDFs, Spaltenmasken-Funktionen oder Tag-basierte Policies" },
          { step: "03 · Databricks Compute", detail: "Nativ durchgesetzt in Spark-Clustern, Databricks-Notebooks, SQL Warehouses und Delta Sharing" },
        ],
        takeaway: "Optimal, wenn Daten, Pipelines, Notebooks und ML-Workloads überwiegend im Databricks Lakehouse leben.",
      },
      us: {
        name: "Classifyre",
        badge: "Herstellerunabhängige Governance · Apache-2.0",
        flow: [
          { step: "01 · 40+ & eigene Quellen", detail: "Verbindet Postgres, MySQL, ODBC, Iceberg, Databricks Delta, Parquet-Buckets, Wikis und Fachsysteme direkt" },
          { step: "02 · Detektoren & Gruppenregeln", detail: "Automatische PII-/Secret- & eigene KI-/Regex-Klassifizierung steuert 5 Maskenarten und Zeilenfilter" },
          { step: "03 · SQL, BI & Datenprodukte", detail: "Persönliche Power-BI-, Excel-, ODBC- und SQL-Verbindungen plus Datenanfragen & Delta-Datenprodukte" },
        ],
        takeaway: "Optimal, wenn Ihre Landschaft über Databricks hinausgeht, On-Premises-/OpenShift-/Kubernetes-Souveränität verlangt oder vollständig Open Source sein soll.",
      },
    },
    scorecard: {
      title: "Funktionsvergleich auf einen Blick",
      lede: "Eine ehrliche Einordnung, wo Unity Catalog überlegen ist und wo Classifyre besser passt.",
      items: [
        {
          dimension: "Native Databricks-Notebooks, Spark-ETL & ML-Modell-Governance",
          them: { level: "native", label: "Tief integriert" },
          us: { level: "none", label: "Außerhalb von Classifyre" },
        },
        {
          dimension: "Quellübergreifende Governance (On-Prem-DBs, ODBC, Iceberg, Dateien, SaaS)",
          them: { level: "partial", label: "Via Lakehouse Federation" },
          us: { level: "native", label: "40+ & eigene Konnektoren" },
        },
        {
          dimension: "Vollständiges Open Source (UI, Masking, SSO, Audit, Lineage)",
          them: { level: "partial", label: "OSS-Server ist Teilmenge" },
          us: { level: "native", label: "100 % Apache-2.0" },
        },
        {
          dimension: "Spaltenmaskierung ohne Code (schwärzen, letzte 4, Hash, leer, verborgen)",
          them: { level: "supported", label: "SQL-UDFs / Tag-ABAC" },
          us: { level: "native", label: "Klassifizierungsbasiert im UI" },
        },
        {
          dimension: "Standard- + eigene KI/ML/Regex/Python-Detektoren (Tabellen & Dokumente)",
          them: { level: "supported", label: "Databricks-Tabellenklassifizierung" },
          us: { level: "native", label: "PII, Secrets, lokale KI & LLM" },
        },
        {
          dimension: "Power-BI-, Excel- & ODBC-Zugriff ohne Cloud-Warehouse-Kosten",
          them: { level: "supported", label: "Über Databricks SQL Warehouse" },
          us: { level: "native", label: "Integriertes TLS-Postgres-Gateway" },
        },
        {
          dimension: "Datenanfragen & verwaltete Datenprodukte",
          them: { level: "native", label: "Zugriffsanfragen & Delta Sharing" },
          us: { level: "native", label: "Anfragen & Live-/Delta-Shares" },
        },
        {
          dimension: "On-Premises, Air-Gapped & Kubernetes / OpenShift Eigenbetrieb",
          them: { level: "partial", label: "Vollumfang nur in der Cloud" },
          us: { level: "native", label: "Vollständig auf K8s & OpenShift" },
        },
      ],
    },
    tradeoffs: {
      title: "Stärken und ehrliche Grenzen – auf beiden Seiten",
      lede: "Klare Grenzen helfen, die richtige Kombination für Ihre Datenplattform zu wählen.",
      themPros: {
        heading: "Wo Unity Catalog stark ist",
        items: [
          "Nahtlose Governance ohne zusätzlichen Hop innerhalb von Databricks Spark-Jobs, Python-/SQL-Notebooks, SQL Warehouses und MLflow-Modellen.",
          "Petabyte-Skalierung mit integriertem Delta Sharing und automatischer Spalten-Lineage in Databricks-Pipelines.",
          "Open-Source Unity-Catalog-Server (LF AI & Data) schafft offene Katalog-APIs für verschiedene Lakehouse-Engines.",
        ],
      },
      themCons: {
        heading: "Wo Unity Catalog an Grenzen stößt",
        items: [
          "Der volle Funktionsumfang (UI, automatische Klassifizierung, Audit-Systemtabellen, umfassende Lineage) setzt die kommerzielle Databricks-Cloud voraus, nicht nur den OSS-Server.",
          "Architektonisch stark an Databricks gebunden – On-Premises-Datenbanken, Nicht-Databricks-Dateien, Wikis oder Air-Gapped-Netze verursachen Zusatzaufwand und Cloud-Kosten.",
          "Spaltenmasken und Zeilenfilter erfordern meist das Erstellen und Pflegen von SQL-UDFs oder Databricks-spezifischen ABAC-Tags.",
        ],
      },
      usPros: {
        heading: "Wo Classifyre stark ist",
        items: [
          "Herstellerunabhängig und 100 % Apache-2.0 Open Source: komplette Weboberfläche, SSO, Rollen, Maskierung, SQL-/BI-Gateway, Datenprodukte und Audit-Logs ohne Cloud-Bindung.",
          "Steuert 40+ heterogene Quellen – On-Prem PostgreSQL/MySQL/ODBC, Iceberg, Delta, Parquet, Databricks, Buckets und unstrukturierte Dokumente – aus einer Oberfläche.",
          "Integrierte PII- und Secret-Pakete plus eigene Geschäftsdetektoren (Regex, Python, lokale CPU-KI wie GLiNER2, LLMs) steuern die mehrstufige Maskierung automatisch.",
          "Vollständig selbst betreibbar auf Docker, Kubernetes oder OpenShift – auch komplett offline oder im eigenen Rechenzentrum.",
        ],
      },
      usCons: {
        heading: "Ehrliche Grenzen von Classifyre",
        items: [
          "Regelt keine Databricks-Notebooks, Spark-ETL-Cluster oder MLflow-Modelle, die direkt in Databricks Compute laufen.",
          "Liest Databricks-Delta-Tabellen über Unity Catalog External Data Access (Tabellen, keine Databricks-SQL-Views).",
          "Ersetzt keine verteilte Petabyte-Spark-Engine für schwere Data-Engineering-Transformationen.",
        ],
      },
    },
    chooseWhen: {
      title: "Entscheidungshilfe: Unity Catalog oder Classifyre?",
      them: {
        heading: "Wählen Sie Unity Catalog, wenn …",
        items: [
          "Ihre Organisation Databricks als primäre Cloud-Daten- und KI-Plattform standardisiert hat.",
          "Sie native Governance für Spark-Notebooks, ML-Modelle und Petabyte-Databricks-Pipelines brauchen.",
          "Der Betrieb in der Databricks-Cloud zu Ihrem Budget und Ihren Datenschutzvorgaben passt.",
        ],
      },
      us: {
        heading: "Wählen Sie Classifyre, wenn …",
        items: [
          "Ihre Daten über On-Premises-Datenbanken, Iceberg-/Delta-/Parquet-Speicher, SaaS-Systeme und ggf. Databricks parallel verteilt sind.",
          "Sie eine 100 % Open-Source-Plattform für Kubernetes, OpenShift oder On-Premises ohne Cloud-Herstellerbindung suchen.",
          "Sie automatische Erkennung, mehrstufige Maskierung ohne SQL-UDFs, persönlichen Power-BI-/Excel-/ODBC-Zugriff und fachliche Datenprodukt-Anfragen benötigen.",
        ],
      },
    },
    rows: [
      {
        aspect: "Lizenz & Open-Source-Umfang",
        them: "Kommerzielle Databricks-Plattform; LF AI & Data OSS-Server deckt eine Katalog-Teilmenge ab",
        us: "100 % Apache-2.0 Open Source – komplette UI, SSO, Maskierung, Zeilenfilter, Gateway und Audit",
      },
      {
        aspect: "Quellen-Reichweite",
        them: "Databricks Lakehouse, Delta/Iceberg via UniForm und Lakehouse Federation",
        us: "40+ heterogene Quellen (On-Prem-DBs, ODBC, Iceberg, Delta, Parquet, Databricks, Buckets, Wikis) + eigene Plugins",
      },
      {
        aspect: "Spaltenmaskierung",
        them: "SQL-Maskierungsfunktionen pro Spalte oder Tag-basiertes ABAC",
        us: "Klassifizierungsbasiert oder per Dialog: geschwärzt, letzte vier, deterministischer Hash, leer, verborgen",
      },
      {
        aspect: "Zeilenfilter",
        them: "SQL-Zeilenfilter-Funktionen pro Tabelle oder ABAC-Policies",
        us: "Geschlossene Gruppen-Zeilenfilter – identisch wirksam in SQL, BI, Exporten und Datenprodukten",
      },
      {
        aspect: "Erkennung & Klassifizierung",
        them: "Datenklassifizierung für Databricks-Tabellen (kommerzielle Plattform)",
        us: "Standard-PII & Secrets + eigene Regex-, Python-, lokale CPU-KI- (GLiNER2) und LLM-Detektoren für Tabellen und Dokumente",
      },
      {
        aspect: "Notebooks & ML-Governance",
        them: "Nativ für Spark-Notebooks, Volumes, Feature Stores und MLflow-Modelle",
        us: "Nicht in Databricks Compute; steuert SQL, BI, MCP-Agenten und geteilte Datenprodukte",
      },
      {
        aspect: "Betrieb & Souveränität",
        them: "Databricks-Cloud (AWS, Azure, GCP); minimaler OSS-Server selbst betreibbar",
        us: "Gesamte Plattform auf Docker, Kubernetes & OpenShift – On-Prem, Private Cloud oder Public Cloud; offline-fähig",
      },
    ],
    note: "Databricks und das LF-AI-&-Data-Projekt entwickeln sich laufend weiter; prüfen Sie den aktuellen Stand in der offiziellen Dokumentation. Korrekturen gerne an contact@classifyre.com.",
    sources: [
      {
        label: "Databricks: Zeilenfilter und Spaltenmasken",
        href: "https://docs.databricks.com/en/data-governance/unity-catalog/filters-and-masks/",
      },
      {
        label: "Unity Catalog Open-Source-Repository (LF AI & Data)",
        href: "https://github.com/unitycatalog/unitycatalog",
      },
      {
        label: "Classifyre: Lakehouse- & Databricks-Quellen",
        href: docs.lakehouse,
      },
      {
        label: "Classifyre: SQL, Maskierung & geteilte Datasets",
        href: docs.dataQuery,
      },
    ],
  },
  notDo: {
    title: "Was Classifyre nicht tut",
    body: "Classifyre setzt keine Masken innerhalb von Databricks-Compute-Clustern durch und ersetzt Unity Catalog nicht für Databricks-Notebooks und Spark-Jobs. Direkte Notebook-Zugriffe in Databricks folgen weiterhin den Regeln von Unity Catalog.",
  },
  faq: [
    {
      q: "Kann Classifyre parallel zu Unity Catalog eingesetzt werden?",
      a: "Ja – viele hybride Teams nutzen beides. Unity Catalog regelt Spark-Pipelines und Notebooks in Databricks, während Classifyre Databricks-Delta-Tabellen (über External Data Access) gemeinsam mit PostgreSQL, Iceberg, Parquet und ODBC-Systemen für Power BI, Excel, Maskierung und Audit-Logs bündelt.",
    },
    {
      q: "Kann Classifyre Unity-Catalog-Delta- und Iceberg-Tabellen lesen?",
      a: "Ja. Classifyre fragt Databricks-Unity-Catalog-Delta-Tabellen ab (bei aktiviertem External Data Access) und scannt Iceberg-REST-Kataloge einschließlich des Iceberg-REST-Endpunkts von Unity Catalog. Databricks-SQL-Views werden gelistet, sind aber mangels eigener Dateien nicht direkt abfragbar.",
    },
    {
      q: "Wie verhält sich Classifyre zum Open-Source Unity-Catalog-Server?",
      a: "Der Open-Source Unity-Catalog-Server konzentriert sich auf offene Katalog-APIs für verschiedene Engines, während Management-UI, automatische Klassifizierung und Audit-Funktionen in der kommerziellen Databricks-Plattform liegen. Classifyre liefert die vollständige Governance-Plattform unter Apache-2.0.",
    },
  ],
  related: ["data-access-governance", "immuta-alternative"],
};

export const deTopics: Record<TopicId, TopicCopy> = {
  "data-access-governance": accessGovernance,
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
