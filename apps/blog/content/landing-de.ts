import type { LandingCopy } from "./landing";

import { docs, routes } from "@/lib/site";

/**
 * German landing-page copy: a full translation of `en` in `./landing.ts`,
 * type-checked against `LandingCopy` so a missing string fails the build.
 *
 * Wording: Datenmaskierung, Datenklassifizierung, DSGVO-konform,
 * Datensouveränität, On-Premises. Maskierung ist keine Anonymisierung; die
 * gehashte Maske ist Pseudonymisierung.
 */

const deDemo = {
  marker: "Wenn etwas abfließt",
  title: "Das ist der Teil, den die meisten Werkzeuge Ihnen überlassen.",
  tabs: {
    caseBoard: "Fall 042",
    queue: "Befund-Queue",
    autopilot: "Autopilot-Log",
  },
  caseBoard: {
    label: "Ein Fall, der sich selbst zusammenstellt",
    figcaption:
      "Eine klassifizierte Datei, per Mail nach draußen: Absender zurückverfolgt, Auswirkung eingegrenzt, Duplikat bestätigt, jedes Beweisstück zugeordnet.",
    exhibits: [
      {
        tag: "EML",
        text: "Die externe Mail selbst: Header, Empfänger, Zeitstempel",
      },
      {
        tag: "ID",
        text: "Absender-Identität über das Verzeichnis hinweg aufgelöst",
      },
      {
        tag: "CLASS",
        text: "Klassifizierungsmarkierung im Anhang gefunden",
      },
      {
        tag: "DUP",
        text: "Internes Original per Fingerprint bestätigt",
      },
    ],
  },
  queue: {
    label: "Befunde, gereiht; nicht aufgelistet",
    columns: {
      finding: "Befund",
      where: "Wo",
      score: "Score",
      reason: "Warum gereiht",
    },
    rows: [
      {
        finding: "Zugriffsschlüssel in einem Build-Log",
        where: "gitlab-ci / build.log",
        score: "0.94",
        reason: "Deterministisches Schlüsselmuster in einem weltweit lesbaren Log, zweimal in einer Woche.",
      },
      {
        finding: "Kundenliste hat das Unternehmen verlassen",
        where: "mail-gateway / EML",
        score: "0.87",
        reason: "421 Kundenzeilen in einem Anhang an eine private Adresse.",
      },
      {
        finding: "Lieferantenvertrag, zweite Kopie",
        where: "sharepoint / einkauf",
        score: "0.71",
        reason: "Near-Duplicate des unterschriebenen Originals: Klausel 7 weicht ab.",
      },
      {
        finding: "Gehaltstabelle in einem privaten Drive",
        where: "drive / privat",
        score: "0.68",
        reason: "Payroll-Spalten plus Mitarbeitenden-Identifier, außerhalb des HR-Workspaces.",
      },
      {
        finding: "Registereintrag widerspricht den Einreichungen",
        where: "firmenbuch / öffentlich",
        score: "0.52",
        reason: "Firma als aktiv markiert; seit 34 Jahren keine Jahresabschlüsse eingereicht.",
      },
    ],
    footnote:
      "Der Score ist die Wichtigkeit von 0 bis 1, mit aufgeschriebenen Gründen, kein Schweregrad-Label, dem Sie blind vertrauen müssen.",
  },
  autopilot: {
    label: "Zwischen den Scans, niemand hat einen Prompt getippt",
    rows: [
      {
        time: "02:14",
        agent: "Anfrage",
        text: "3 frische Befunde zur stehenden Frage „PII verlassen das Unternehmen“ gematcht.",
      },
      {
        time: "02:15",
        agent: "Fall",
        text: "Fall 042 eröffnet, zwei konkurrierende Hypothesen entworfen, 4 Beweise angehängt.",
      },
      {
        time: "02:16",
        agent: "Konfiguration",
        text: "Die Quelle mail-gateway hat über drei Scans nichts gefunden. Größeres Sampling vorgeschlagen.",
      },
      {
        time: "02:17",
        agent: "Detektor-Autor",
        text: "Detektor für Klassifizierungsmarkierungen entworfen. Dry-run: 12 Treffer im letzten Korpus.",
      },
      {
        time: "02:18",
        agent: "Dream",
        text: "Memory konsolidiert: zwei Priors bestätigt, einer vor dem nächsten Zyklus verworfen.",
      },
    ],
    footnote:
      "Der Observe-only-Modus hält jede Aktion bei einem Vorschlag. Jeder Schritt loggt, was er getan hat und warum.",
  },
  cta: "Die echte Sache ansehen",
} as const;

const de: LandingCopy = {
  hero: {
    chips: ["Open-Source-Data-Governance-Plattform"],
    titleA: "Finden. Schützen.",
    titleBLead: "",
    titleBHighlight: "Nutzen.",
    lede: "Classifyre findet personenbezogene Daten und Secrets in den Systemen, die Sie bereits betreiben, maskiert sie automatisch und lässt Ihr Team alles mit SQL, Excel und Power BI abfragen. Jeder Lesezugriff wird protokolliert. Nichts verlässt Ihre Server.",
    ctaPrimary: "Auf Ihrem Rechner starten",
    ctaSecondary: "Live-Showcase ansehen",
    micro: "Keine Anmeldung. Ein Docker-Befehl. Ihre Daten bleiben bei Ihnen.",
  },

  sheet: {
    readAs: "Lesen als",
    personas: {
      analyst: "Analystin",
      steward: "Klartext-Leser",
    },
    notes: {
      analyst:
        "Personenbezogene Spalten sind in der Abfrage maskiert. Die Token-Spalte ist ausgeblendet.",
      steward:
        "Klartext-Lesen für diese Tabelle bis 30. Juni freigegeben. Dieser Zugriff ist protokolliert.",
    },
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
    replay: "Nochmal",
  },

  path: {
    label: "Der Weg der Daten durch Classifyre",
    steps: [
      { verb: "Verbinden", examples: ["Iceberg-Tabellen via S3", "PostgreSQL · crm", "Delta in Databricks", "Confluence-Wiki"] },
      { verb: "Erkennen", examples: ["IBAN gefunden · 0,99", "AWS-Schlüssel · 0,96", "SVNR gefunden · 0,93", "E-Mail gefunden · 0,98"] },
      { verb: "Verwalten", examples: ["Owner: Finanzen", "Spalte maskiert", "Secret ausgeblendet", "Steward benannt"] },
      { verb: "Freigeben", examples: ["Analysten · 90 Tage", "Klartext · Finanzen", "Zeilenfilter · Graz", "Anfrage genehmigt"] },
      { verb: "Teilen", examples: ["orders + customers", "Geteilt, Masken bleiben", "Join mit lake.orders", "Parquet-Export"] },
      { verb: "BI anbinden", examples: ["Power BI via ODBC", "Excel · eigener Login", "Tableau · nur TLS", "DBeaver · JDBC"] },
      { verb: "Protokollieren", examples: ["Lena liest · Power BI", "Tom liest · SQL-Seite", "Agent liest · MCP", "Jakob exportiert · Excel"] },
    ],
  },

  mascots: {
    questioning:
      "Der Classifyre-Ermittler im Trenchcoat kratzt sich am Kopf über ein unbeantwortbares Fragezeichen",
    lookingAround: "Der Classifyre-Ermittler schaut sich um und sucht die Spur",
    lookingAtYou: "Der Classifyre-Ermittler sieht Sie direkt an",
    hiddenGem:
      "Der Classifyre-Ermittler hält eine Lupe über einen verborgenen Fund",
  },

  install: {
    marker: "Hier starten",
    title: "Heute Abend ein Befehl. Derselbe Kern im großen Maßstab.",
    lede: "Das All-in-one-Image enthält Datenbank, Oberfläche und Scan-Worker; alles bleibt auf Ihrem Rechner. Das Helm-Chart betreibt denselben Kern auf Kubernetes, wenn die Umgebung wächst.",
    dockerLabel: "All-in-one-Image · kostenlos · ohne Anmeldung",
    dockerTitle: "Dort betreiben, wo Sie schon arbeiten",
    dockerCta: "Einrichtung & Konfiguration",
    helmLabel: "Helm-Chart · skaliert beliebig",
    helmTitle: "Oder auf Kubernetes betreiben",
    helmCopy:
      "Kurzlebige Scan- und Abfrage-Worker skalieren zwischen den Läufen auf null und so weit, wie Ihre Umgebung reicht. Ihr Cluster, Ihre Daten.",
    helmCtaDocs: "Helm-Chart-Dokumentation",
    helmCtaRepo: "Chart-README auf GitHub",
  },

  tension: {
    marker: "Das Problem",
    title: "Ihre Daten sind wertvoll. Und voller personenbezogener Daten.",
    lede: "Jedes Team will die Zahlen. Jede Tabelle, die sie enthält, enthält auch Namen, Konten, Adressen und das eine oder andere Passwort. Also wird Zugriff zur Verhandlung, und die Verhandlung endet in einer Tabellenkalkulation.",
    notes: [
      {
        label: "Feldnotiz 01",
        title: "Wer darf diese Spalte sehen?",
        body: "Die Finanzabteilung will die Kundendatenbank. Welche ihrer 212 Tabellen enthalten personenbezogene Daten? Niemand weiß es, also wartet das Ticket, oder alle bekommen alles.",
      },
      {
        label: "Feldnotiz 02",
        title: "Schick mir einfach den Export",
        body: "Daten gehen per CSV und geteiltem Datenbankpasswort hinaus. Sechs Kopien später weiß niemand, wo die Kundenliste liegt oder wer sie noch hat.",
      },
      {
        label: "Feldnotiz 03",
        title: "Weisen Sie es der Prüferin nach",
        body: "Wer hat im letzten Quartal die Gehaltstabellen gelesen, mit welchem Werkzeug? Ohne Protokoll jedes Zugriffs lautet die ehrliche Antwort: Wir wissen es nicht.",
      },
    ],
    kicker:
      "Es ist jedes Mal dasselbe Muster: nützliche Daten weggesperrt, weil niemand sagen kann, was darin personenbezogen ist, oder ganz herausgegeben, weil niemand Zeit hatte, Nein zu sagen. Standardmäßig maskiert, bewusst freigegeben, jeder Zugriff protokolliert: Das ist der Ausweg.",
    figureCaption:
      "Abb. 01: sechs Systeme, überall personenbezogene Daten, keine Linie, wer was sehen darf",
    nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
  },

  journey: {
    marker: "So funktioniert es",
    tape: "Liest 40+ Systeme direkt an der Quelle · nie kopiert",
    tapeLink: "Zum Quellenkatalog",
    title: "Von der Rohtabelle zum geteilten Datensatz.",
    lede: "Folgen Sie den Daten durch Classifyre: gefunden, wo sie liegen, direkt abgefragt, verwaltet, in den Werkzeugen genutzt, die Ihr Team schon hat, maskiert für alle, die sie nicht sehen sollen, und bewusst geteilt.",
    stages: [
      {
        id: "discover",
        step: "Verbinden & erkennen",
        title: "Personenbezogene Daten und Secrets dort finden, wo sie liegen",
        body: [
          "Verbinden Sie Datenbanken, Lakehouses, Buckets und SaaS-Werkzeuge; Classifyre liest sie direkt an der Quelle, nichts wird in ein weiteres Data Warehouse kopiert. Mitgelieferte Detektoren suchen nach 41 Arten personenbezogener Daten, darunter österreichische, deutsche und Schweizer Kennungen, und 27 Arten von Secrets. Eigene Detektoren per Regex, Modell oder Prompt.",
          "Jeder Fund hat einen Score und eine schriftliche Begründung, also kann die Datenschutzbeauftragte ihn prüfen und das Security-Team das Aufräumen priorisieren. Die so entstandene Klassifizierung ist das, dem die Masken später folgen.",
        ],
        facts: ["40+ Quelltypen", "41 PII-Arten · 27 Secret-Muster", "Score und Begründung bei jedem Fund"],
        href: docs.detectors,
        linkLabel: "Detektor-Pakete ansehen",
        media: "discover",
        caption: "Personenbezogene Daten in drei Quellen gefunden, mit Begründung gewichtet.",
      },
      {
        id: "query",
        step: "Über Quellen abfragen",
        title: "Jedes System mit einer SQL-Abfrage befragen",
        body: [
          "Stellen Sie Fragen über die Systeme, die Sie schon haben: PostgreSQL, MySQL, Databricks sowie Delta-, Iceberg- und Parquet-Dateien in S3, Azure oder Google Cloud Storage. Bis zu acht Quellen in einer Abfrage verknüpfen. Jede Abfrage läuft neben den Daten; nichts wird vorher zentral geladen.",
          "Ergebnisse landen dort, wo Menschen arbeiten: auf der SQL-Seite, als Export nach Excel, CSV und Parquet bis zu einer Million Zeilen, oder direkt im BI-Werkzeug.",
        ],
        facts: ["Bis zu 8 Quellen pro Abfrage", "Delta · Iceberg · Parquet · CSV", "Exporte bis 1 Mio. Zeilen"],
        href: docs.dataQuery,
        linkLabel: "Daten abfragen",
        media: "query",
        caption: "Eine PostgreSQL-Tabelle mit Parquet-Dateien in einem Bucket verknüpft.",
      },
      {
        id: "govern",
        step: "Governance",
        title: "Governance: Owner, Vertrag und Verlauf für jede Tabelle",
        body: [
          "Eine verwaltete Tabelle hat einen Owner, Stewards und einen Custodian, eine Klassifizierung für jede Spalte und einen Status von Entwurf bis zertifiziert. Qualitätsregeln prüfen sie nach Zeitplan: fehlende Werte, ungültige IBANs, Duplikate, Zeilenzahlen oder beliebiges SQL. Die Vereinbarung lässt sich als ODCS-Datenvertrag exportieren.",
          "Die Nutzung zeigt, wer die Tabelle mit welchem Werkzeug liest; die Aktivität zeigt jeden Zugriff und jede Änderung, alter Wert neben neuem. Wenn die Prüferin fragt, steht die Antwort schon da.",
        ],
        facts: ["Owner, Stewards, Custodians", "Qualitätsregeln nach Zeitplan", "ODCS-Datenverträge", "Jeder Zugriff und jede Änderung protokolliert"],
        href: docs.governance,
        linkLabel: "Verwaltete Assets",
        media: "govern",
        caption: "Owner, Steward und Custodian zugewiesen, Zugriff gesetzt, eine Qualitätsregel ausgeführt, die Tabelle zertifiziert, der Vertrag exportiert.",
      },
      {
        id: "bi",
        step: "Power BI & Excel",
        title: "Power BI und Excel ohne geteiltes Passwort anbinden",
        body: [
          "Classifyre antwortet wie eine PostgreSQL-Datenbank. Jede Person legt ihre eigene SQL-Verbindung an, verschlüsselt und befristet, und verbindet Power BI, Excel, Tableau oder DBeaver damit. Kein Dienstkonto mit dem Schlüssel zu allem, kein Passwort in einer Berichtsdatei.",
          "Die Verbindung trägt die Rechte der Person: die Tabellen, die sie abfragen darf, die Zeilen ihrer Gruppe, die Masken auf jeder personenbezogenen Spalte. Widerrufen, und der Bericht stoppt.",
        ],
        facts: ["Eine persönliche Verbindung pro Werkzeug", "Nur TLS, befristet, widerrufbar", "Das Protokoll nennt das Werkzeug"],
        href: docs.sqlConnections,
        linkLabel: "SQL-Verbindungen",
        media: "bi",
        caption: "Eine persönliche Verbindung, genutzt aus einem BI-Bericht, weiterhin maskiert.",
      },
      {
        id: "mask",
        step: "Maskieren pro Person",
        title: "Maskiert für die eine Person, Klartext für die andere",
        body: [
          "Personenbezogene Spalten sind standardmäßig maskiert: geschwärzt, letzte vier, gehasht und trotzdem verknüpfbar, oder ausgeblendet. Masken greifen in der Abfrage, also kommt kein WHERE und kein JOIN an ihnen vorbei. Nur eine Gruppe mit Data reader, unmasked liest Klartext, für eine Quelle oder eine Tabelle, mit Ablaufdatum. Admins haben das standardmäßig nicht.",
          "Die gehashte Maske ist Pseudonymisierung im Sinne der DSGVO, keine Anonymisierung: Gleiche Werte ergeben denselben Hash, also können Analysten Personen verknüpfen und zählen, ohne zu lesen, wer sie sind. Unten läuft es: dieselben Abfragen, von einer Analystin und einem Data Steward der Finanzabteilung.",
        ],
        facts: ["Standardmäßig maskiert", "Geschwärzt · letzte vier · gehasht · ausgeblendet", "Pseudonymisierung, keine Anonymisierung", "Klartext ist eine eigene Freigabe"],
        href: docs.masking,
        linkLabel: "So funktioniert die Maskierung",
        media: "readers",
        caption: "",
      },
      {
        id: "share",
        step: "Teilen",
        title: "Einen Datensatz teilen, der Ihre Quellen verknüpft",
        body: [
          "Verknüpfen Sie Tabellen aus verschiedenen Systemen zu einem geteilten Datensatz (Kunden aus dem CRM, Bestellungen aus dem Lake, Rechnungen aus der Finanz) und geben Sie ihn den Gruppen, die ihn brauchen. Ein geteilter Datensatz ist eine verwaltete, gespeicherte Abfrage, keine Kopie: Er liest die Quellen live, und die Masken jeder Eingangstabelle reisen mit, als Untergrenze, die nur steigen kann.",
          "Das empfangende Team fragt ihn ab wie jede Tabelle, auf der SQL-Seite, in Excel oder in Power BI, und jeder Zugriff ist protokolliert.",
        ],
        facts: ["Joins über Quellen", "Masken reisen mit", "Freigabe pro Gruppe, mit Ablaufdatum"],
        href: docs.sharedDatasets,
        linkLabel: "Geteilte Datasets",
        media: "share",
        caption: "Drei Quellen zu einem Datensatz verknüpft, mit einer Gruppe geteilt, Masken behalten.",
      },
    ],
  },

  readers: {
    readers: {
      masked: { name: "Lena, Analystin", role: "Data reader" },
      clear: { name: "Tom, Data Steward Finanzen", role: "Data reader, unmasked" },
    },
    rowsLabel: (n: number) => (n === 1 ? "1 Zeile" : `${n} Zeilen`),
    variants: [
      {
        id: "select",
        label: "SELECT",
        note: "Dieselben Zeilen, andere Zellen. Lena sieht die letzten vier Ziffern; Tom liest das Konto im Klartext.",
      },
      {
        id: "where",
        label: "WHERE",
        note: "Ein Filter auf den Klartext findet für Lena nichts: Er läuft auf dem maskierten Wert, nicht daran vorbei.",
      },
      {
        id: "join",
        label: "JOIN",
        note: "Die gehashte E-Mail joint trotzdem: Gleiche Werte ergeben denselben Hash, also verknüpft Lena Tabellen, ohne eine Adresse zu lesen.",
      },
      {
        id: "group",
        label: "GROUP BY",
        note: "Zählen funktioniert auf maskierten Spalten. Die Antwort ist brauchbar; die Person dahinter bleibt verdeckt.",
      },
    ],
    caption:
      "Maskierte Daten zu lesen ist eine eigene Freigabe, mit Ablaufdatum, und sie ist protokolliert.",
    link: "So funktioniert die Maskierung",
  },

  demo: deDemo,

  sectors: {
    marker: "Wo es ankommt",
    title: "Die Daten sehen anders aus. Die Regeln sind dieselben.",
    lede: "Classifyre liest, worauf die Organisation läuft; die Branche entscheidet nur, welche Spalten personenbezogen sind und wer sie im Klartext liest.",
    columns: {
      sector: "Branche",
      data: "Typische Daten",
      finds: "Was sich ändert",
    },
    rows: [
      {
        sector: "Öffentliche Hand · Länder · Städte",
        data: "Register, Akten, Statistik, Beschaffung",
        finds: "Bezirke fragen ihre eigenen Zeilen ab, personenbezogene Spalten kommen maskiert, die DSB liest das Protokoll",
      },
      {
        sector: "Gesundheit · Spitäler",
        data: "Aufnahmen, Laborwerte, Dienstpläne, Abrechnung",
        finds: "Analysten zählen Patienten, ohne zu lesen, wer sie sind",
      },
      {
        sector: "Banken · KYC",
        data: "Kundenstamm, Transaktionen, Konten",
        finds: "IBANs als letzte vier, gehashte IDs, die trotzdem joinen, ein Protokoll für die Aufsicht",
      },
      {
        sector: "Versicherungen",
        data: "Schäden, Polizzen, Gesundheitsangaben",
        finds: "Aktuare bekommen die Tabellen, nicht die Versicherten",
      },
      {
        sector: "BI · Analytics-Teams",
        data: "Warehouses, Lakehouses, Delta- und Iceberg-Tabellen",
        finds: "Power BI und Excel über persönliche Verbindungen statt eines geteilten Passworts",
      },
      {
        sector: "Security-Teams",
        data: "Git, Wikis, Tickets, Buckets, Logs",
        finds: "Schlüssel und Tokens gefunden, begründet gewichtet, zuerst aufgeräumt",
      },
      {
        sector: "Revision · Compliance",
        data: "Zugriffsprotokolle, Gehälter, Verträge",
        finds: "Wer welche Tabelle mit welchem Werkzeug wann gelesen hat: ein Filter",
      },
      {
        sector: "Vorfallbearbeitung",
        data: "Mail, Laufwerke, Datenbanken",
        finds: "Ein Fingerabdruck über Systeme, bearbeitet als Fall",
      },
    ],
    footnote:
      "Jede Zeile ist ein Einstieg, kein eigenes Produkt: darunter liegen dieselben Masken, Freigaben und dasselbe Zugriffsprotokoll.",
    links: [
      { label: "Immuta-Alternative", href: "/immuta-alternative" },
      { label: "Unity-Catalog-Alternative", href: "/unity-catalog-alternative" },
      { label: "Zu den Fallakten", href: routes.blog + "/cases" },
    ],
  },

  editions: {
    marker: "Open Source und Enterprise",
    title: "Alles ist Open Source. Enterprise ist auf Ihre Organisation zugeschnitten.",
    lede: "Betreiben Sie es selbst oder mit Ihren Beratern: Jede Funktion ist im Open-Source-Repository. Behalten Sie Ihre ETL-Werkzeuge, Pipelines und Datenprodukte, wie sie sind. Classifyre baut sie nicht; es verwaltet, was sie erzeugen.",
    oss: {
      title: "Open Source",
      sub: "Jede Funktion · für immer kostenlos",
      items: [
        "40+ Quell-Konnektoren",
        "Erkennung von PII und Secrets, eigene Detektoren",
        "Spaltenmasken: geschwärzt, letzte vier, gehasht, leer, ausgeblendet",
        "Owner, Stewards, Qualitätsregeln, ODCS-Verträge",
        "Freigaben pro Gruppe, Quelle und Tabelle, mit Ablaufdatum",
        "SQL-Seite, Exporte, geteilte Datasets",
        "PostgreSQL-Endpunkt für Power BI, Excel, Tableau",
        "Protokoll jedes Lesezugriffs",
        "SSO, Rollen, Mandanten und Workspaces",
        "Fälle, Anfragen, Lineage, Autopilot",
      ],
    },
    ent: {
      title: "Enterprise",
      sub: "Auf Ihre Organisation zugeschnitten",
      items: [
        {
          title: "Ihr Stack bleibt",
          body: "Ihre ETL-Jobs, dbt-Modelle, Spark-Pipelines und Datenprodukte bleiben, wo sie sind. Classifyre liest, was sie erzeugen, und verwaltet es: Owner, Masken, Qualität, Zugriff. Auch in Open Source.",
        },
        {
          title: "So, wie Sie arbeiten",
          body: "Rollen auf Ihre Gruppen abgebildet, ein Zugriffsmodell, das Ihre Datenschutzbeauftragte unterschreiben kann, Detektoren und Modelle für Ihre Fachsprache und Dokumente, OpenShift, wenn das Ihre Plattform ist.",
        },
        {
          title: "Ihr Team, Ihr Integrator oder wir",
          body: "Führen Sie es selbst ein, mit Ihren Beratern oder mit unseren Ingenieuren. Ein Pilot zum Festpreis ist da, wenn Sie schneller starten wollen; niemand muss auf uns warten.",
        },
        {
          title: "Support und SLA",
          body: "Betreute Releases und Sicherheitspatches, ein benannter Kontakt und veröffentlichte Reaktionszeiten, wenn jemand Verantwortung tragen muss.",
        },
      ],
    },
    ctaPilot: "Über Enterprise sprechen",
    ctaCompare: "Open Source und Enterprise vergleichen",
  },

  convert: {
    marker: "Ihr Zug",
    title: "Öffnen Sie Ihre Daten sicher, noch heute Abend.",
    lede: "Richten Sie es auf eine Datenbank, die Sie bereits betreiben. Am Morgen wissen Sie, welche Spalten personenbezogene Daten enthalten, und Ihr Team kann den Rest abfragen. Alles, was Sie einrichten, kommt mit auf Kubernetes.",
    paths: [
      {
        label: "Heute Abend, auf Ihrem Rechner",
        text: "Ein Docker-Befehl. Quellen, Masken und das Zugriffsprotokoll bleiben lokal.",
      },
      {
        label: "Im großen Maßstab, auf Kubernetes",
        text: "Derselbe Kern als Helm-Chart: Worker skalieren zwischen den Läufen auf null.",
      },
      {
        label: "Wenn es Infrastruktur wird",
        text: "Ihr Team oder Ihr Integrator betreibt es. Enterprise schneidet es auf Ihre Organisation zu, bringt OpenShift und ein SLA. Jede Funktion ist schon Open Source.",
      },
    ],
    ctaPrimary: "Einrichtung & Konfiguration",
    ctaSecondary: "Live-Showcase ansehen",
    ctaEnterprise: "Über Enterprise sprechen",
    ctaBlog: "Die Feldnotizen lesen",
  },

  faq: {
    marker: "Klare Antworten",
    title: "Fragen, die wirklich gestellt werden.",
    lede: "",
    items: [
      {
        q: "Was ist Classifyre?",
        a: "Open-Source-Data-Governance, die Sie selbst betreiben. Classifyre liest die Systeme, die Sie haben, findet personenbezogene Daten und Secrets darin, maskiert diese Spalten automatisch und lässt Menschen die Tabellen mit SQL, Exporten, Excel und Power BI abfragen. Jeder Lesezugriff wird protokolliert: wer, welche Tabelle, welches Werkzeug, wann.",
      },
      {
        q: "Ist wirklich alles Open Source, auch SSO und Rollen?",
        a: "Ja. Jede Funktion steht unter Apache-2.0: Konnektoren, Erkennung, Maskierung, Freigaben, Zeilenfilter, der SQL-Endpunkt, das Zugriffsprotokoll, SSO, Rollen, Mandanten und Workspaces. Es gibt keine Enterprise-Version mit zusätzlichem Code. Enterprise ist dasselbe Produkt, auf Ihre Organisation zugeschnitten, mit Support und SLA; die Einführung selbst oder mit Ihrem Integrator ist immer möglich.",
      },
      {
        q: "Ersetzt Classifyre unsere ETL- oder Datenprodukt-Werkzeuge?",
        a: "Nein. Behalten Sie Ihre ETL-Werkzeuge, Pipelines, dbt-Modelle und Datenprodukte. Classifyre baut und bewegt keine Daten: Es liest, was diese Werkzeuge erzeugen, direkt an der Quelle, und verwaltet es mit Klassifizierung, Ownern, Masken, Qualitätsregeln und Zugriff, jeder Lesezugriff protokolliert. Das funktioniert genauso in Open Source.",
      },
      {
        q: "Was unterscheidet Classifyre von Immuta, Unity Catalog oder Trino?",
        a: "Immuta ist ein kommerzielles Produkt, das Zugriffsrichtlinien in Cloud-Datenplattformen wie Snowflake und Databricks durchsetzt. Unity Catalog ist die Governance-Schicht von Databricks. Trino föderiert Abfragen und überlässt Ihnen das Finden und Maskieren personenbezogener Daten. Classifyre erledigt alle drei Aufgaben in einem selbst betriebenen Open-Source-Produkt, über 40+ Systeme.",
      },
      {
        q: "Funktioniert es mit Power BI und Excel?",
        a: "Ja. Classifyre antwortet wie eine PostgreSQL-Datenbank. Power BI, Excel, Tableau, DBeaver und jeder JDBC- oder ODBC-Client verbinden sich mit einer persönlichen, verschlüsselten Verbindung, die abläuft und widerrufen werden kann. Masken und Zeilenfilter gelten dort genau wie in der App, und jeder Zugriff wird mit dem Namen des Werkzeugs protokolliert.",
      },
      {
        q: "Ist Maskierung dasselbe wie Anonymisierung?",
        a: "Nein. Maskierung verbirgt Werte vor Personen, die sie nicht sehen dürfen; die Daten selbst bleiben unverändert, und die Berechtigten können sie weiterhin lesen. Die gehashte Maske ist Pseudonymisierung im Sinne der DSGVO: Gleiche Werte ergeben denselben Hash, Tabellen lassen sich also verknüpfen, aber der Wert ist nicht lesbar.",
      },
      {
        q: "Wohin gehen meine Daten? Verlässt etwas unsere Infrastruktur?",
        a: "Nirgendwohin. Classifyre läuft in Ihrem Netz und speichert alles in Ihrer eigenen PostgreSQL-Datenbank und Ihrem Speicher. Abfragen laufen dort, wo die Daten liegen. Es läuft offline, und KI-Funktionen nutzen nur die Anbieter, die Sie konfigurieren, auch selbst betriebene Modelle.",
      },
      {
        q: "Läuft es auf Kubernetes und OpenShift?",
        a: "Am schnellsten starten Sie mit einem Docker-Image auf macOS, Windows oder Linux. Derselbe Kern kommt als Helm-Chart für Kubernetes, wo Worker als Jobs laufen und zwischen den Läufen auf null skalieren. Installation und Betreuung auf OpenShift sind Teil von Enterprise.",
      },
      {
        q: "Ist es noch ein Ermittlungswerkzeug?",
        a: "Ja, für den Tag, an dem etwas abfließt. Fälle, stehende Anfragen, Fingerabdrücke über Quellen und der Autopilot sind alle noch da und Open Source. Governance ist, was Sie jeden Tag betreiben; die Ermittlung ist, was Sie öffnen, wenn es darauf ankommt.",
      },
    ],
  },
};

export default de;
