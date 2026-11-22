import type { LandingCopy } from "./landing";

import { docs, routes } from "@/lib/site";

/**
 * German landing-page copy, type-checked against `LandingCopy`.
 *
 * Idiomatic B2B German (Sie-Form) for C-Level, Data Leaders, CISOs, and DPOs
 * across Austria, Germany, Switzerland, and Europe.
 */

const deDemo = {
  marker: "Vorfallbearbeitung",
  title: "Wenn sensible Daten abfließen, klären Sie es an einem Ort.",
  tabs: {
    caseBoard: "Fall 042",
    queue: "Befund-Liste",
    autopilot: "Autopilot-Log",
  },
  caseBoard: {
    label: "Zusammengeführter Vorfall",
    figcaption:
      "Eine klassifizierte Datei per E-Mail nach außen gesendet: Absender identifiziert, Original per Fingerabdruck bestätigt, jeder Nachweis verknüpft.",
    exhibits: [
      { tag: "EML", text: "Externe E-Mail mit Headern, Empfänger und Zeitstempel" },
      { tag: "ID", text: "Absender über das Unternehmensverzeichnis aufgelöst" },
      { tag: "CLASS", text: "Interne Klassifizierungsmarkierung im Anhang erkannt" },
      { tag: "DUP", text: "Internes Original per deterministischem Fingerabdruck bestätigt" },
    ],
  },
  queue: {
    label: "Priorisierte Befunde mit Begründung",
    columns: {
      finding: "Befund",
      where: "Fundort",
      score: "Score",
      reason: "Begründung",
    },
    rows: [
      {
        finding: "Zugriffsschlüssel im Build-Log",
        where: "gitlab-ci / build.log",
        score: "0.94",
        reason: "Verifiziertes Schlüsselmuster in einem freigegebenen Log, zweimal in einer Woche.",
      },
      {
        finding: "Kundenliste extern versendet",
        where: "mail-gateway / EML",
        score: "0.87",
        reason: "421 Kundendatensätze im Anhang an eine private E-Mail-Adresse.",
      },
      {
        finding: "Abweichende Kopie eines Lieferantenvertrags",
        where: "sharepoint / einkauf",
        score: "0.71",
        reason: "Nahezu identische Kopie des unterzeichneten Originals mit geänderter Klausel 7.",
      },
      {
        finding: "Gehaltstabelle in privater Ablage",
        where: "drive / privat",
        score: "0.68",
        reason: "Gehaltsspalten und Mitarbeitenden-IDs außerhalb des HR-Bereichs.",
      },
      {
        finding: "Abweichung im Firmenregister",
        where: "firmenbuch / öffentlich",
        score: "0.52",
        reason: "Aktiver Lieferant ohne aktuelle Jahresabschlüsse im Register.",
      },
    ],
    footnote:
      "Jeder Befund enthält einen Relevanz-Score von 0 bis 1 und eine klare Begründung für die Priorisierung.",
  },
  autopilot: {
    label: "Automatisierte Vorprüfung zwischen Scans",
    rows: [
      {
        time: "02:14",
        agent: "Anfrage",
        text: "3 neue Befunde der Dauerabfrage „PII verlässt die Organisation“ zugeordnet.",
      },
      {
        time: "02:15",
        agent: "Fall",
        text: "Fall 042 eröffnet, zwei Hypothesen entworfen und 4 Belege verknüpft.",
      },
      {
        time: "02:16",
        agent: "Konfiguration",
        text: "Keine Treffer auf mail-gateway in drei Läufen; breiteres Sampling vorgeschlagen.",
      },
      {
        time: "02:17",
        agent: "Detektor",
        text: "Regel für Klassifizierungsmarkierungen entworfen; Testlauf fand 12 Dokumente.",
      },
      {
        time: "02:18",
        agent: "Prüfung",
        text: "Notizen konsolidiert und Vorschläge zur menschlichen Freigabe bereitgestellt.",
      },
    ],
    footnote:
      "Im Observe-only-Modus bleibt jeder automatisierte Schritt ein Vorschlag. Jede Aktion wird nachvollziehbar protokolliert.",
  },
  cta: "Live-Demo ansehen",
} as const;

const de: LandingCopy = {
  hero: {
    chips: ["Open-Source Data Governance · Apache-2.0"],
    titleA: "Klare Datenregeln.",
    titleBLead: "Durchgesetzt bei",
    titleBHighlight: "jeder Abfrage.",
    lede: "Classifyre verbindet sich mit Ihren bestehenden Datenbanken, Lakehouses und Ihrem Verzeichnisdienst für durchgängige Data Governance. Klassifizieren Sie sensible und fachspezifische Daten, setzen Sie Zeilen- und Spaltenmaskierung nach Gruppen durch, veröffentlichen Sie Datenprodukte und geben Sie Teams direkten Zugriff in SQL, Power BI und Excel – bei lückenloser Protokollierung.",
    ctaPrimary: "Open Source einsetzen",
    ctaSecondary: "Anpassung besprechen",
    ctaShowcase: "Live-Demo ansehen",
    proofBar: [
      { label: "Lizenz", value: "100 % Open Source (Apache-2.0)" },
      { label: "Infrastruktur", value: "Docker, Kubernetes & OpenShift" },
      { label: "Datenlandschaft", value: "Iceberg, Delta, Parquet & 40+ Quellen" },
      { label: "Aus Österreich", value: "EU-Standards · weltweit im Einsatz" },
    ],
  },

  sheet: {
    readAs: "Ansicht als",
    personas: {
      analyst: "Analystin · Region Graz",
      steward: "Finance Steward",
      admin: "Plattform-Admin",
    },
    notes: {
      analyst:
        "Zeilenfilter beschränkt das Ergebnis auf Graz. Personenbezogene Spalten sind in der Abfrage maskiert, die Token-Spalte ist ausgeblendet.",
      steward:
        "Zeitlich begrenzte Klartext-Freigabe bis 30. Juni. Jeder Lesezugriff wird im Audit-Log protokolliert.",
      admin:
        "Voller Infrastrukturzugriff auf alle Zeilen – personenbezogene Werte bleiben standardmäßig maskiert.",
    },
    rowFilter: "Zeilenfilter · city = 'Graz'",
    hidden: "1 Spalte ausgeblendet",
    tags: {
      name: "Person · 0,97",
      iban: "IBAN · 0,99",
      email: "E-Mail · 0,98",
      token: "Secret · 0,96",
    },
    masks: {
      redact: "geschwärzt",
      partial: "letzte vier",
      hash: "gehasht",
      hidden: "ausgeblendet",
    },
    replay: "Wiederholen",
  },

  path: {
    label: "Durchgängige Data Governance mit Classifyre",
    steps: [
      {
        verb: "Integrieren",
        examples: ["PostgreSQL · CRM", "Iceberg & Parquet", "Databricks Delta", "Eigene Quellen"],
      },
      {
        verb: "Erkennen",
        examples: ["PII & Kennungen", "Secrets & Schlüssel", "Regex & Python-Regeln", "Lokale KI & LLMs"],
      },
      {
        verb: "Steuern",
        examples: ["Entra ID & AD-Gruppen", "Owner & Stewards", "Zeilenfilter", "Befristete Freigaben"],
      },
      {
        verb: "Maskieren",
        examples: ["Geschwärzt & verborgen", "Letzte vier (IBAN)", "Gehashte Joins", "Vererbt auf Shares"],
      },
      {
        verb: "SQL & BI",
        examples: ["Power BI via ODBC", "Excel-Livezugriff", "Kontrolliertes SQL", "KI-Agenten via MCP"],
      },
      {
        verb: "Teilen & Prüfen",
        examples: ["Datenanfragen", "Owner-Freigabe", "Delta-Datenprodukte", "Jeder Zugriff geloggt"],
      },
    ],
  },

  mascots: {
    questioning: "Classifyre-Diagramm zu Datenabfluss",
    lookingAround: "Classifyre-Übersichtsgrafik",
    lookingAtYou: "Classifyre-Governance-Grafik",
    hiddenGem: "Classifyre-Datenerkennung",
  },

  install: {
    marker: "Selbst betriebenes Deployment",
    title: "Mit Docker testen. Auf Kubernetes oder OpenShift betreiben.",
    lede: "Prüfen Sie den offenen Quellcode, testen Sie lokal mit echten Daten in wenigen Minuten und betreiben Sie exakt denselben Kern im Cluster – ohne versteckte Enterprise-Schranken.",
    dockerLabel: "All-in-One-Container · ohne Registrierung",
    dockerTitle: "Lokale Evaluierung mit Docker",
    dockerCta: "Installationsleitfaden",
    helmLabel: "Helm-Chart · Kubernetes & OpenShift",
    helmTitle: "Skalierbar auf Ihrem Cluster",
    helmCopy:
      "Zustandslose Scan- und Abfrage-Worker skalieren zwischen Läufen auf null und wachsen mit Ihrer Datenlandschaft. Betrieb On-Premises, in Ihrer Private Cloud oder auf AWS, Azure und GCP.",
    helmCtaDocs: "Kubernetes- & OpenShift-Doku",
    helmCtaRepo: "Helm-Chart auf GitHub",
  },

  tension: {
    marker: "Warum Classifyre",
    title: "Data Governance, ohne Ihre bestehende Landschaft zu ersetzen.",
    lede: "Sie betreiben bereits Datenbanken, Lakehouses, ETL-Pipelines und ein zentrales Benutzerverzeichnis. Proprietäre Governance-Suiten kosten hohe Nutzerlizenzen oder binden Sie an einen einzelnen Cloud-Anbieter – während manuelle Exporte und geteilte Datenbank-Passwörter jede Prüfung erschweren.",
    diagram: {
      leftLabel: "Ihre bestehenden Systeme",
      leftSources: ["PostgreSQL · MySQL · Oracle", "Iceberg · Delta · Parquet", "S3 · Azure · GCS · Dateien", "Eigene & SaaS-Quellen"],
      iamLabel: "Ihr bestehendes IAM",
      iamSystems: "Entra ID · Active Directory · Okta · OIDC / SAML",
      centerTitle: "Classifyre Governance-Schicht",
      centerSub: "Open Source · Selbst betrieben · Direkt an der Quelle",
      centerPillars: [
        "Standard- & eigene Detektoren",
        "Gruppenrechte & Zeilenfilter",
        "Mehrstufige Spaltenmaskierung",
        "Datenanfragen & Audit-Log",
      ],
      rightLabel: "Kontrollierte Nutzung",
      rightTools: ["Power BI & Tableau", "Excel & ODBC-Clients", "SQL-Arbeitsbereich", "Delta-Datenprodukte"],
    },
    notes: [
      {
        label: "01 · Keine Migration",
        title: "ETL, IAM und Speicher bleiben bestehen",
        body: "Classifyre liest Datenbanken, Iceberg- und Delta-Tabellen sowie Dateispeicher direkt an der Quelle. Gruppen bleiben in Entra ID, Active Directory oder Okta, und Ihre bestehenden Pipelines laufen unverändert weiter.",
      },
      {
        label: "02 · Mehrstufige Kontrolle",
        title: "Jede Gruppe sieht genau das Richtige",
        body: "Regionale Teams sehen nur ihre eigenen Zeilen mit maskierten Personendaten, Finance Stewards erhalten befristeten Klartext, und Plattform-Admins verwalten die Infrastruktur ohne Einblick in Kundendaten.",
      },
      {
        label: "03 · Kontrollierter Self-Service",
        title: "Schluss mit unkontrollierten Exporten",
        body: "Ersetzen Sie CSV-Dateien und geteilte Service-Passwörter durch persönliche, widerrufbare SQL-, Power-BI- und Excel-Verbindungen sowie einen klaren Anfrageprozess für neue Datenprodukte.",
      },
      {
        label: "04 · Revisionssicher",
        title: "Belastbare Nachweise für Audit & Datenschutz",
        body: "Jeder Lesezugriff, Export, jede Freigabe und Datenprodukt-Genehmigung wird mit Person und Werkzeug protokolliert – jederzeit abrufbar für Revision und Datenschutzbeauftragte.",
      },
    ],
    kicker:
      "Die transparente Open-Source-Alternative zu proprietären Data-Governance-Systemen: prüfbarer Quellcode, Betrieb auf Ihrer eigenen Infrastruktur und keine Lizenzkosten pro Nutzer.",
    figureCaption: "Classifyre verbindet Ihre bestehende Datenlandschaft mit den Werkzeugen, die Ihre Teams bereits nutzen.",
    nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
  },

  journey: {
    marker: "Durchgängige Plattform",
    tape: "Integriert 40+ Systeme direkt an der Quelle · keine Datenkopien",
    tapeLink: "Unterstützte Quellen ansehen",
    title: "Von der Rohquelle bis zum verwalteten Datenprodukt.",
    lede: "Sechs nahtlos verbundene Bausteine für den gesamten Governance-Lebenszyklus – von der Erkennung bis zur täglichen BI-Auswertung und geteilten Datenprodukten.",
    stages: [
      {
        id: "discover",
        step: "Verbinden & erkennen",
        title: "Bekannte oder eigene Quellen verbinden und gezielt klassifizieren",
        body: [
          "Verbinden Sie über 40 Quellsysteme – relationale Datenbanken, Iceberg, Delta, Parquet, Object Storage, Wikis und Kollaborationstools – oder binden Sie eigene Konnektoren für Fachsysteme an. Alle Daten werden direkt an der Quelle gelesen.",
          "Starten Sie mit fertigen Paketen für personenbezogene Daten (AT/DE/CH, EU und weltweit) sowie Secrets und ergänzen Sie fachspezifische Detektoren: von einfachen Regex- und Python-Regeln über schlanke lokale KI-Modelle auf Ihrer CPU (z. B. GLiNER2, Text- und Bildklassifikation) bis zu Entscheidungsmodellen und eigenen LLMs.",
        ],
        facts: [
          "40+ Standard- & eigene Quellen",
          "PII, Secrets & eigene Geschäftsregeln",
          "Regex, Python, lokale CPU-KI & LLMs",
          "Score und Begründung bei jedem Fund",
        ],
        href: docs.detectors,
        linkLabel: "Detektoren ansehen",
        media: "discover",
        caption: "Quellen direkt an der Quelle gescannt; personenbezogene Daten und Geschäftssignale begründet gewichtet.",
      },
      {
        id: "access",
        step: "Berechtigen & organisieren",
        title: "Zugriffssteuerung entlang Ihrer Organisationsstruktur",
        body: [
          "Binden Sie Ihren bestehenden Verzeichnisdienst an (Entra ID, Active Directory, Okta oder OIDC/SAML). Freigaben gelten immer für Gruppen – auf Workspaces, Quellen, Tabellen oder Datenprodukte. Wechselt jemand die Abteilung, passt sich der Zugriff bei der nächsten Anmeldung automatisch an.",
          "Benennen Sie Data Owner und Stewards, befristen Sie temporäre Freigaben und lassen Sie Zugriffsanfragen direkt durch die fachlich Verantwortlichen entscheiden. Admins lesen standardmäßig keinen Klartext.",
        ],
        facts: [
          "Synchronisation mit Entra ID, AD & Okta",
          "Gruppenfreigaben mit Ablaufdatum",
          "Zeilenfilter pro Gruppe",
          "Freigabeprozess über Data Owner",
        ],
        href: docs.whoMayQuery,
        linkLabel: "So funktioniert die Zugriffssteuerung",
        media: "access",
        caption: "Verzeichnisgruppen auf Freigaben abgebildet: Bezirke sehen eigene Zeilen, Finanzen erhalten befristeten Klartext.",
      },
      {
        id: "mask",
        step: "Mehrstufige Maskierung",
        title: "Spalten- und Zeilenmaskierung – abgestuft je Gruppe",
        body: [
          "Schützen Sie Daten von einzelnen Spalten bis auf Zeilenebene mit flexiblen Maskierungsarten: vollständig geschwärzt, letzte vier Stellen (etwa bei IBANs), deterministisch gehasht zur DSGVO-Pseudonymisierung (damit Joins und Auswertungen weiter funktionieren), geleert oder komplett ausgeblendet.",
          "Masken greifen direkt in der Abfrage-Engine, sodass Filter und Joins geschützte Werte nicht offenlegen können. Dieselben Regeln gelten auf Originaltabellen und reisen automatisch auf geteilte Datenprodukte mit – jede Gruppe arbeitet auf der passenden Schutzstufe.",
        ],
        facts: [
          "Geschwärzt · letzte vier · gehasht · leer · verborgen",
          "Zeilenfilter + Spaltenmasken kombiniert",
          "Auf Originaltabellen & Datenprodukten",
          "DSGVO-Pseudonymisierung, join-fähig",
        ],
        href: docs.masking,
        linkLabel: "So funktioniert die Maskierung",
        media: "readers",
        caption: "",
      },
      {
        id: "bi",
        step: "SQL, Power BI, Excel & ODBC",
        title: "Kontrollierter Live-Zugriff in den gewohnten Werkzeugen",
        body: [
          "Fachabteilungen und Analysten bleiben bei ihren vertrauten Tools. Classifyre stellt einen standardisierten PostgreSQL-kompatiblen Endpunkt bereit, sodass Power BI, Excel, Tableau, DBeaver und jeder ODBC- oder JDBC-Client über persönliche, verschlüsselte und befristete Verbindungen zugreifen.",
          "Jede Abfrage unterliegt exakt den Gruppenrechten, Zeilenfiltern und Spaltenmasken der jeweiligen Person – egal ob im SQL-Editor, in Excel, in Power BI oder über KI-Assistenten via MCP. Wird eine Verbindung widerrufen, endet der Zugriff sofort.",
        ],
        facts: [
          "Power BI, Excel, Tableau & ODBC",
          "Persönliche, befristete Verbindungen",
          "Quellenübergreifendes SQL (bis 8 Systeme)",
          "MCP-Agenten übernehmen Nutzerrechte",
        ],
        href: docs.sqlConnections,
        linkLabel: "SQL- & BI-Verbindungen",
        media: "bi",
        caption: "Eine persönliche Power-BI-Verbindung liest live aus verwalteten Tabellen – maskiert und protokolliert.",
      },
      {
        id: "share",
        step: "Anfragen & Datenprodukte",
        title: "Datensätze in Alltagssprache anfragen. Datenprodukte sicher teilen.",
        body: [
          "Fachanwender können neue, kombinierte Datensätze in natürlicher Sprache oder über einen strukturierten Anfrageprozess anfordern – etwa die Verknüpfung von CRM-Kunden mit Bestellungen aus dem Lakehouse nach Region, ohne Personennamen. Anfragen gehen zur Prüfung, Umsetzung und Freigabe an Data Owner oder Datenteams.",
          "Veröffentlichte Datenprodukte – als Live-Abfrage über mehrere Quellen oder als Delta-basiertes geteiltes Datenprodukt – erben automatisch alle Masken und Klassifizierungen ihrer Quelltabellen als Untergrenze und lassen sich pro Zielgruppe weiter einschränken.",
        ],
        facts: [
          "Datenanfragen in natürlicher Sprache",
          "Prüfung & Freigabe durch Data Owner",
          "Live- & Delta-Datenprodukte",
          "Quellmasken automatisch als Untergrenze",
        ],
        href: docs.sharedDatasets,
        linkLabel: "Geteilte Datasets & Datenprodukte",
        media: "share",
        caption: "Fachliche Datenanfrage geprüft und als verwaltetes Datenprodukt mit vererbten Masken freigegeben.",
      },
      {
        id: "govern",
        step: "Nachweis & Qualität",
        title: "Klare Verantwortlichkeiten, Datenqualität und lückenloses Audit-Log",
        body: [
          "Jede verwaltete Tabelle und jedes Datenprodukt hat benannte Owner, Stewards und Custodians, dokumentierte Spaltenklassifizierungen, einen Zertifizierungsstatus und zeitgesteuerte Qualitätsprüfungen für fehlende Werte, ungültige Kennungen, Duplikate oder eigene SQL-Regeln.",
          "Jeder Lesezugriff, Export, jede Rechteänderung und Datenprodukt-Freigabe wird mit Person, Zeitpunkt und Werkzeug festgehalten. Prüfungen nach DSGVO, NIS2, DORA oder durch die interne Revision werden damit zu einer klaren Auswertung statt zu manueller Rekonstruktion.",
        ],
        facts: [
          "Owner, Stewards & Zertifizierung",
          "Geplante Datenqualitätsprüfungen",
          "Offene Datenverträge (ODCS)",
          "Lückenloses Zugriffsprotokoll",
        ],
        href: docs.governance,
        linkLabel: "Governance- & Audit-Doku",
        media: "govern",
        caption: "Verantwortung zugewiesen, Masken geprüft, Qualitätsregeln bestanden und offenen Datenvertrag exportiert.",
      },
    ],
  },

  readers: {
    readers: {
      masked: { name: "Lena · Regionale Analystin", role: "Maskierter Zugriff" },
      clear: { name: "Tom · Finance Steward", role: "Klartext-Freigabe" },
    },
    rowsLabel: (n: number) => (n === 1 ? "1 Zeile" : `${n} Zeilen`),
    variants: [
      {
        id: "select",
        label: "SELECT",
        note: "Dieselbe Abfrage, unterschiedliche Rechte. Lena sieht geschwärzte Namen und die letzten vier IBAN-Stellen; Tom liest dank befristeter Freigabe im Klartext.",
      },
      {
        id: "where",
        label: "WHERE",
        note: "Ein Filter auf eine unmasked IBAN liefert für Lena null Treffer – die Maskierung greift in der Abfrage, sodass Werte nicht erraten werden können.",
      },
      {
        id: "join",
        label: "JOIN",
        note: "Deterministisch gehashte E-Mails lassen sich tabellenübergreifend verknüpfen: Lena wertet Support-Tickets aus, ohne eine einzige Adresse zu sehen.",
      },
      {
        id: "group",
        label: "GROUP BY",
        note: "Zählungen und Aggregationen funktionieren zuverlässig auf maskierten Spalten – volle Aussagekraft bei geschützten Identitäten.",
      },
    ],
    caption:
      "Klartext-Zugriff ist immer eine ausdrückliche, befristete Freigabe – niemals Teil von Admin-Rechten – und wird vollständig protokolliert.",
    link: "So funktioniert die Maskierung",
  },

  demo: deDemo,

  sectors: {
    marker: "Praxisszenarien",
    title: "Eine Tabelle. Passende Regeln für jede Gruppe.",
    lede: "Ob in Österreich, der EU, Nordamerika oder weltweit: Das Prinzip bleibt konsistent – jede Gruppe sieht nur die Zeilen, Spalten und Schutzstufen, die zu ihrer Aufgabe passen.",
    columns: {
      sector: "Branche & Bereich",
      data: "Typische Quellen",
      finds: "So greift die mehrstufige Governance",
    },
    rows: [
      {
        sector: "Banken & Finanzdienstleister",
        data: "Kundenstamm, Transaktionen, KYC-Daten, Delta- & Iceberg-Lakes",
        finds: "Analysten arbeiten in Power BI mit letzten vier IBAN-Stellen und gehashten IDs; Compliance erhält befristeten Klartext mit revisionssicherem Protokoll.",
      },
      {
        sector: "Öffentliche Hand & Verwaltung",
        data: "Register, Fachverfahren, Statistik-Warehouses, Beschaffung",
        finds: "Jeder Bezirk oder jede Dienststelle sieht per Zeilenfilter nur die eigenen Fälle; Personendaten bleiben maskiert; die DSB prüft das Zugriffsprotokoll.",
      },
      {
        sector: "Gesundheitswesen & Spitäler",
        data: "Aufnahmen, Laborwerte, klinische Kohorten, Abrechnung",
        finds: "Auswertungsteams zählen Kohorten und verknüpfen Datensätze über gehashte IDs, ohne jemals Patientennamen oder Sozialversicherungsnummern zu lesen.",
      },
      {
        sector: "Versicherungen & Aktuariat",
        data: "Schadensdaten, Polizzen, Risikoprüfung",
        finds: "Aktuare arbeiten in SQL und Excel live auf Schadensdaten, während Versichertennamen und Gesundheitsangaben geschwärzt oder ausgeblendet bleiben.",
      },
      {
        sector: "BI-Teams & Datenprodukte",
        data: "PostgreSQL, Databricks, Iceberg, Parquet in S3/Azure/GCS",
        finds: "Fachbereiche fordern kombinierte Datensätze in Alltagssprache an; Owner prüfen und veröffentlichen verwaltete Live- oder Delta-Datenprodukte mit vererbten Masken.",
      },
      {
        sector: "Security & Interne Revision",
        data: "Zugriffsprotokolle, Gehaltsdaten, Git, Wikis, Dateiserver",
        finds: "Eine Ansicht beantwortet, wer welche Tabelle oder welches Datenprodukt wann und womit gelesen hat – während Secret-Detektoren exponierte Schlüssel früh erkennen.",
      },
    ],
    footnote:
      "Alle Szenarien laufen auf demselben Apache-2.0-Kern – ohne separate Module oder kostenpflichtige Zusatzpakete.",
    links: [
      { label: "Berechtigungskonzept umsetzen", href: "/berechtigungskonzept-umsetzen" },
      { label: "Unterstützte Quellen", href: routes.sources },
      { label: "vs. Immuta", href: "/immuta-alternative" },
      { label: "vs. Unity Catalog", href: "/unity-catalog-alternative" },
      { label: "Über Classifyre", href: routes.madeInEurope },
    ],
  },

  convert: {
    marker: "Open Source & individuelle Anpassung",
    title: "100 % Open Source. Maßgeschneidert bei Bedarf.",
    lede: "Jede Funktion von Classifyre steht offen unter Apache-2.0 – so können Ihre IT- und Sicherheitsteams die Softwarequalität direkt im Code prüfen und alles selbst betreiben. Wenn Ihre Organisation eine maßgeschneiderte Einführung braucht, arbeiten wir direkt mit Ihrem Team zusammen.",
    paths: [
      {
        label: "IAM, Sicherheit & Organisationsdesign",
        text: "Anbindung an komplexe Verzeichnisstrukturen, Mandantenmodelle sowie unternehmensspezifische Sicherheits- und Datenschutzrichtlinien.",
      },
      {
        label: "Eigene Datenquellen & Konnektoren",
        text: "Entwicklung und Absicherung von Konnektoren für branchenspezifische, gewachsene oder proprietäre Fachsysteme.",
      },
      {
        label: "Delta-Datenprodukte & Freigabeprozesse",
        text: "Aufbau verwalteter Delta-Datenprodukte, bereichsübergreifender Freigabe-Workflows und fachlicher Datenanfragen.",
      },
      {
        label: "Fachspezifische Detektoren & KI-Modelle",
        text: "Umsetzung eigener Geschäftsregeln, Compliance-Klassifikatoren sowie lokaler oder maßgeschneiderter KI- und LLM-Modelle.",
      },
    ],
    tailoringTitle: "Classifyre passgenau auf Ihre Organisation abstimmen?",
    tailoringLede:
      "Es gibt keine separate Enterprise-Edition mit gesperrten Funktionen. Betreiben Sie alles selbst – oder arbeiten Sie direkt mit unserem Engineering-Team zu individuell vereinbartem Umfang passend zu Ihrer Infrastruktur, Sicherheitsarchitektur und Ihren Zielen.",
    ctaPrimary: "Mit uns sprechen",
    ctaSecondary: "Installationsleitfaden",
    ctaShowcase: "Live-Demo ansehen",
    ctaBlog: "Fachartikel lesen",
  },

  faq: {
    marker: "Häufige Fragen",
    title: "Klare Antworten für Management, IT und Datenschutz.",
    lede: "",
    items: [
      {
        q: "Was unterscheidet Classifyre von proprietären Systemen wie Immuta, Purview oder Unity Catalog?",
        a: "Proprietäre Lösungen binden Governance oft an eine einzelne Cloud-Plattform (wie Unity Catalog an Databricks) oder verlangen hohe kommerzielle Lizenzen und SaaS-Abhängigkeiten. Classifyre ist 100 % Open Source unter Apache-2.0, läuft auf Ihrer eigenen Infrastruktur über 40+ Datenbanken, Lakehouses (Iceberg, Delta, Parquet) und Dateispeicher und vereint Klassifizierung, mehrstufige Maskierung, SQL/BI-Zugriff, Datenprodukte und Audit-Protokollierung in einer transparenten Plattform.",
      },
      {
        q: "Ersetzt Classifyre unsere bestehenden ETL-Pipelines, unser IAM oder unsere BI-Tools?",
        a: "Nein. Classifyre integriert sich bewusst in Ihre bestehende Landschaft. Behalten Sie Ihre ETL-Strecken, dbt-Modelle, Ihren Identity Provider (Entra ID, Active Directory, Okta, OIDC/SAML) sowie Power BI, Excel und Tableau. Classifyre wirkt als zentrale Governance- und Zugriffsschicht darüber.",
      },
      {
        q: "Wie funktionieren Spaltenmaskierung und Zeilenfilter für verschiedene Gruppen?",
        a: "Berechtigungen folgen immer Ihren Verzeichnisgruppen. Auf jeder Quelltabelle und jedem Datenprodukt können Sie Zeilen pro Gruppe filtern (z. B. nach Region oder Abteilung) und sensible Spalten geschwärzt, mit den letzten vier Stellen, als gehashte Pseudonymisierung, geleert oder verborgen ausliefern. Verschiedene Gruppen erhalten auf derselben Tabelle automatisch unterschiedliche Sichten – und Workspace-Admins lesen standardmäßig keinen Klartext.",
      },
      {
        q: "Können Fachabteilungen neue Datenprodukte anfordern und teilen?",
        a: "Ja. Fachanwender beschreiben ihren Datenbedarf in natürlicher Sprache oder über einen strukturierten Anfrageprozess – zum Beispiel eine Auswertung aus CRM und Lakehouse nach Region. Data Owner und Datenteams prüfen, erstellen und veröffentlichen daraus ein verwaltetes Datenprodukt (Live-Dataset oder Delta-Share). Alle Masken und Klassifizierungen der Quelltabellen werden dabei automatisch als Untergrenze vererbt.",
      },
      {
        q: "Welche Detektoren sind enthalten – und können wir eigene Geschäftsregeln erkennen?",
        a: "Classifyre bringt fertige Pakete für personenbezogene Daten (inkl. AT/DE/CH-, EU- und internationaler Kennungen) sowie Secrets mit. Darüber hinaus erstellen Sie eigene fachspezifische Detektoren – von schnellen Regex- und Python-Regeln über lokale CPU-KI-Modelle (wie GLiNER2, Text- und Bildklassifikation) bis zu Entscheidungsmodellen und selbst gehosteten oder angebundenen LLMs.",
      },
      {
        q: "Wie verbinden sich Power BI, Excel, SQL und ODBC-Werkzeuge?",
        a: "Classifyre bietet einen TLS-verschlüsselten, PostgreSQL-kompatiblen Endpunkt. Jede Person erstellt ihre eigene, befristete und widerrufbare Verbindung für Power BI, Excel, Tableau, DBeaver oder beliebige ODBC/JDBC-Clients – ganz ohne geteilte Datenbankpasswörter. Jede Abfrage setzt Zeilenfilter und Spaltenmasken durch und protokolliert Zugriff samt Werkzeug.",
      },
      {
        q: "Gibt es eine kostenpflichtige Enterprise-Edition oder ist wirklich alles Open Source?",
        a: "Alle Funktionen stehen unter Apache-2.0 im offenen Quellcode: SSO, Rollen, Zeilenfilter, dynamische Maskierung, SQL/BI-Gateway, Datenprodukte, Audit-Log und Helm-Chart. Wir sperren keine Sicherheitsfunktionen hinter einer Enterprise-Lizenz. Organisationen beauftragen uns, wenn sie Unterstützung bei IAM-Integration, Organisationsdesign, eigenen Konnektoren, Delta-Datenprodukten oder maßgeschneiderten Detektoren wünschen.",
      },
      {
        q: "Wo läuft Classifyre – verlassen Daten jemals unsere Infrastruktur?",
        a: "Nein. Classifyre läuft vollständig auf Ihrer eigenen Infrastruktur – lokal mit Docker zur Evaluierung oder produktiv auf Kubernetes und OpenShift, On-Premises, im eigenen Rechenzentrum oder in Ihrer Cloud (AWS, Azure, Google Cloud). Auch ein komplett abgeschotteter Offline-Betrieb ist möglich.",
      },
    ],
  },

  incident: {
    metaTitle: "Open-Source-Vorfallbearbeitung bei Datenabfluss",
    metaDescription:
      "Wenn personenbezogene Daten oder Zugangsdaten abfließen: priorisierte Befunde, systemübergreifende Fingerabdrücke, strukturierte Fälle und transparente Vorprüfung.",
    breadcrumb: "Vorfallbearbeitung",
    chip: "Anwendungsfall · Vorfallbearbeitung",
    titleLead: "Wenn sensible Daten abfließen,",
    titleHighlight: "schnell aufklären.",
    lede: "Tägliche Governance verhindert die meisten Vorfälle. Wenn dennoch eine Kundenliste per E-Mail abfließt oder ein Schlüssel in einem Repository auftaucht, unterstützt dieselbe Erkennungs-Engine Ihre Aufklärung: Dauerabfragen, systemübergreifende Fingerabdrücke, dokumentierte Fälle und transparente Vorprüfung.",
    ctaPrimary: "Live-Fall ansehen",
    ctaSecondary: "Fallakten lesen",
    points: {
      marker: "Funktionen",
      title: "Vom ersten Hinweis zum belastbaren Ergebnis.",
      items: [
        {
          title: "Dauerabfragen",
          body: "Gespeicherte Fragestellungen (z. B. „PII verlässt die Organisation“), die bei jedem Scan passende Befunde automatisch hervorheben.",
          href: docs.inquiry,
        },
        {
          title: "Systemübergreifende Fingerabdrücke",
          body: "Deterministischer Duplikat- und Ähnlichkeitsabgleich, der abgeflossene Dateien zuverlässig mit ihrer internen Quelle verknüpft.",
          href: docs.duplicates,
        },
        {
          title: "Fälle & Belege",
          body: "Strukturierte Arbeitsbereiche, die Belege bündeln, Hypothesen gegenüberstellen und den Entscheidungsweg dokumentieren.",
          href: docs.cases,
        },
        {
          title: "Kontrollierter Autopilot",
          body: "Automatisierte Agenten pflegen Fingerabdrücke und entwerfen Fallzusammenfassungen zwischen Scans – jeder Schritt ist protokolliert und steuerbar.",
          href: docs.autopilot,
        },
      ],
      linkLabel: "Zur Dokumentation",
    },
    faq: [
      {
        q: "Wie hängt die Vorfallbearbeitung mit der Data-Governance-Plattform zusammen?",
        a: "Beide nutzen dieselben Open-Source-Konnektoren und dieselbe Erkennungs-Engine. Governance steuert den täglichen Datenzugriff; die Vorfallbearbeitung greift, sobald ein Detektor einen unerwarteten Abfluss oder ein exponiertes Secret meldet.",
      },
      {
        q: "Handelt der Autopilot ohne menschliche Freigabe?",
        a: "Nein. Im Observe-only-Modus bleibt jeder Schritt ein Vorschlag zur Freigabe oder Ablehnung, jede Aktion wird protokolliert, und Hintergrund-Agenten lesen niemals direkt Tabellenzeilen.",
      },
      {
        q: "Können Security-Teams diesen Teil eigenständig nutzen?",
        a: "Ja. Verbinden Sie Repositories, Buckets, Mail-Gateways oder Wikis, aktivieren Sie Secret- und PII-Detektoren und starten Sie sofort – kontrollierten SQL-Zugriff und Maskierung schalten Sie bei Bedarf hinzu.",
      },
    ],
  },
};

export default de;
