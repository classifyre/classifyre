import type { LandingCopy } from "./landing";

import { docs, routes } from "@/lib/site";

/**
 * German landing-page copy: a full translation of `en` in `./landing.ts`,
 * type-checked against `LandingCopy` so a missing string fails the build.
 *
 * Erzählung wie im Englischen: Classifyre ist der kontrollierte Zugang zu
 * den Daten einer Organisation. Zuerst das Berechtigungskonzept (Zugriff
 * nach Abteilung, Rolle und Regel), dann Maskierung, Datenprodukte,
 * Werkzeuge, Protokollierung.
 *
 * Wording: Berechtigungskonzept, Datenzugriff steuern, Datenmaskierung,
 * Pseudonymisierung, Protokollierung, Datensouveränität, On-Premises. DSGVO
 * wird "unterstützt", nie "konform". Maskierung ist keine Anonymisierung;
 * die gehashte Maske ist Pseudonymisierung.
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
    chips: ["Open Source · Datenzugriff steuern · On-Premises"],
    // Soft hyphen: the one long word must be able to break in the poster type.
    titleA: "Ihr Berechtigungs\u00ADkonzept.",
    titleBLead: "Bei jeder Abfrage",
    titleBHighlight: "durchgesetzt.",
    lede: "Classifyre liegt zwischen Ihren Mitarbeitenden und den Systemen, die Sie schon betreiben. Abteilung, Rolle und Standort bestimmen, wer welche Tabellen, Zeilen und Spalten sieht. Personenbezogene Daten bleiben maskiert, bis jemand freigegeben ist. Teams bauen Datenprodukte darauf, und jeder Zugriff wird protokolliert. Nichts verlässt Ihre Server.",
    ctaPrimary: "Pilot mit Ihrer Organisation planen",
    ctaSecondary: "Auf einer Datenbank testen",
    ctaShowcase: "Live-Showcase ansehen",
  },

  sheet: {
    readAs: "Lesen als",
    personas: {
      analyst: "Analystin · Bezirk Graz",
      steward: "Steward Finanzen",
      admin: "Workspace-Admin",
    },
    notes: {
      analyst:
        "Der Zeilenfilter ihrer Gruppe zeigt nur Graz. Personenbezogene Spalten sind in der Abfrage maskiert; die Token-Spalte ist ausgeblendet.",
      steward:
        "Klartext-Lesen für diese Tabelle bis 30. Juni freigegeben. Dieser Zugriff ist protokolliert.",
      admin:
        "Alle Zeilen, weiterhin maskiert. Workspace-Admins lesen standardmäßig keinen Klartext.",
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
    replay: "Nochmal",
  },

  path: {
    label: "Der Weg der Daten durch Classifyre",
    steps: [
      { verb: "Verbinden", examples: ["PostgreSQL · crm", "Iceberg-Tabellen via S3", "Delta in Databricks", "Confluence-Wiki"] },
      { verb: "Klassifizieren", examples: ["IBAN gefunden · 0,99", "SVNR gefunden · 0,93", "E-Mail gefunden · 0,98", "Spalte: personenbezogen"] },
      { verb: "Organisieren", examples: ["Gruppe · Bezirk Graz", "AD-Gruppen aus Entra ID", "Zeilenfilter · Graz", "Finanzen · Klartext bis 30.6."] },
      { verb: "Maskieren", examples: ["IBAN · letzte vier", "E-Mail · gehasht", "Name · geschwärzt", "Secret · ausgeblendet"] },
      { verb: "Bauen", examples: ["orders + customers", "Owner: Finanzen", "Masken als Untergrenze", "Freigabe · 90 Tage"] },
      { verb: "Nutzen", examples: ["Power BI via ODBC", "Excel · eigener Login", "Agent · MCP", "Tableau · nur TLS"] },
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
    title: "Ihr Berechtigungskonzept steht auf Papier. Ihre Daten kennen es nicht.",
    lede: "Jede Organisation hat ein Berechtigungskonzept. Es liegt in einem Wiki, die Daten liegen in einem Dutzend Systemen mit eigenen Logins. Also wird Zugriff zum Ticket, das Ticket wird zum Export, und niemand kann sagen, wer was hat.",
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
      {
        label: "Feldnotiz 04",
        title: "Sehen die Bezirke nur ihre eigenen Fälle?",
        body: "Graz will die Fallstatistik. Heute heißt das ein eigener Export pro Bezirk, jeden Monat neu gebaut, und eine Kopie mehr, die niemand nachverfolgt.",
      },
    ],
    kicker:
      "Zugriff, der Ihrer Organisation folgt, standardmäßig maskiert, jeder Zugriff protokolliert: Das ist der Ausweg. Denn es ist jedes Mal dasselbe Muster: nützliche Daten weggesperrt, weil niemand sagen kann, wer sie sehen darf, oder ganz herausgegeben, weil niemand Zeit hatte, Nein zu sagen.",
    figureCaption:
      "Abb. 01: sechs Systeme, sechs Logins und ein Berechtigungskonzept, das keines davon kennt",
    nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
  },

  journey: {
    marker: "So funktioniert es",
    tape: "Liest 40+ Systeme direkt an der Quelle · nie kopiert",
    tapeLink: "Zum Quellenkatalog",
    title: "Vom Organigramm zu kontrollierten Datenprodukten.",
    lede: "Verbinden Sie Ihre Systeme, bilden Sie Abteilungen und Rollen ab, und Classifyre entscheidet jeden Zugriff: welche Zeilen, welche Spalten, maskiert oder im Klartext. Teams bauen darauf Datenprodukte, und Menschen nutzen sie in den Werkzeugen, die sie schon haben.",
    stages: [
      {
        id: "discover",
        step: "Verbinden & klassifizieren",
        title: "Jede Quelle verbinden und klassifizieren",
        body: [
          "Die Klassifizierung entscheidet, was geschützt wird. Verbinden Sie Datenbanken, Lakehouses, Buckets und SaaS-Werkzeuge; Classifyre liest sie direkt an der Quelle, nichts wird in ein weiteres Data Warehouse kopiert. Mitgelieferte Detektoren suchen nach 41 Arten personenbezogener Daten, darunter österreichische, deutsche und Schweizer Kennungen, und 27 Arten von Secrets. Eigene Detektoren per Regex, Modell oder Prompt.",
          "Jeder Fund hat einen Score und eine schriftliche Begründung, also kann die Datenschutzbeauftragte ihn prüfen, bevor er zählt. Die so entstandene Klassifizierung ist das, dem die Masken von da an folgen.",
        ],
        facts: ["40+ Quelltypen", "41 PII-Arten · 27 Secret-Muster", "Score und Begründung bei jedem Fund"],
        href: docs.detectors,
        linkLabel: "Detektor-Pakete ansehen",
        media: "discover",
        caption: "Personenbezogene Daten in drei Quellen gefunden, mit Begründung gewichtet.",
      },
      {
        id: "access",
        step: "Zugriff nach Organisation",
        title: "Der Zugriff folgt Ihrer Organisation",
        body: [
          "Übernehmen Sie Ihre Gruppen aus dem Single Sign-On: Entra ID, Active Directory, Okta oder jedes OIDC- oder SAML-Verzeichnis. Dann geben Sie einer Abteilung eine Quelle, einem Team eine Tabelle, einem Bezirk nur seine eigenen Zeilen, einem Steward Klartext bis zu einem Datum. Zugriff geht immer an Gruppen: Wechselt jemand im Verzeichnis die Abteilung, folgt der Datenzugriff bei der nächsten Anmeldung.",
          "Niemand gibt mehr frei, als er selbst hat, und niemand genehmigt seine eigene Anfrage. Workspace-Admins lesen standardmäßig keinen Klartext: Personenbezogene Daten im Klartext zu lesen ist eine eigene Freigabe, und sie wird protokolliert.",
        ],
        facts: ["AD-Gruppen aus Entra ID, AD, Okta", "Zeilenfilter pro Gruppe, ohne Regel keine Zeile", "Freigaben mit Ablaufdatum", "Anfragen entscheidet der Owner"],
        href: docs.whoMayQuery,
        linkLabel: "Wer was abfragen darf",
        media: "access",
        caption: "Verzeichnisgruppen auf Freigaben abgebildet: Ein Bezirk sieht seine Zeilen, die Finanzen lesen Klartext bis 30. Juni.",
      },
      {
        id: "mask",
        step: "Standardmäßig maskiert",
        title: "Standardmäßig maskiert, direkt in der Abfrage",
        body: [
          "Personenbezogene Spalten sind standardmäßig maskiert: geschwärzt, letzte vier, gehasht und trotzdem verknüpfbar, oder ausgeblendet. Masken greifen in der Abfrage, also kommt kein WHERE und kein JOIN an ihnen vorbei. Nur eine Gruppe mit Data reader, unmasked liest Klartext, für eine Quelle oder eine Tabelle, mit Ablaufdatum.",
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
        step: "Datenprodukte",
        title: "Datenprodukte auf kontrollierten Daten bauen",
        body: [
          "Verknüpfen Sie Quellen zu einem geteilten Datensatz (Kunden aus dem CRM, Bestellungen aus dem Lake, Rechnungen aus der Finanz), benennen Sie eine verantwortliche Gruppe und geben Sie ihn den Gruppen, die ihn brauchen. Das meinen wir mit Datenprodukt: ein benannter Datensatz mit Owner, auf den sich ein Team verlassen und aufbauen kann, ohne dass jemand die Rohtabellen herausgibt.",
          "Ein geteilter Datensatz ist eine gespeicherte Abfrage, keine Kopie: Er liest bis zu acht Quellen live, direkt neben den Daten, von Datenbanken bis zu Delta-, Iceberg- und Parquet-Dateien. Die Masken jeder Eingangstabelle reisen als Untergrenze mit, also kann ein Datenprodukt nie lockerer sein als seine Quellen.",
        ],
        facts: ["Bis zu 8 Quellen live verknüpft", "Masken reisen als Untergrenze mit", "Verantwortliche Gruppe, Leser pro Gruppe"],
        href: docs.sharedDatasets,
        linkLabel: "Geteilte Datasets",
        media: "share",
        caption: "Drei Quellen zu einem Datensatz verknüpft, mit einer Gruppe geteilt, Masken behalten.",
      },
      {
        id: "bi",
        step: "Power BI, Excel & Agenten",
        title: "Nutzen in Power BI, Excel, SQL und KI-Agenten",
        body: [
          "Classifyre antwortet wie eine PostgreSQL-Datenbank. Jede Person legt ihre eigene SQL-Verbindung an, verschlüsselt und befristet, und verbindet Power BI, Excel, Tableau oder DBeaver damit. Kein Dienstkonto mit dem Schlüssel zu allem, kein Passwort in einer Berichtsdatei. Die SQL-Seite und Exporte nach Excel, CSV und Parquet funktionieren genauso.",
          "Die Verbindung trägt die Rechte der Person: die Tabellen, die sie abfragen darf, die Zeilen ihrer Gruppe, die Masken auf jeder personenbezogenen Spalte. KI-Agenten über MCP lesen mit denselben Regeln wie die Person, die sie verbunden hat, nie mehr. Widerrufen, und der Bericht stoppt.",
        ],
        facts: ["Eine persönliche Verbindung pro Werkzeug", "Nur TLS, befristet, widerrufbar", "MCP-Agenten lesen als Sie", "Das Protokoll nennt das Werkzeug"],
        href: docs.sqlConnections,
        linkLabel: "SQL-Verbindungen",
        media: "bi",
        caption: "Eine persönliche Verbindung, genutzt aus einem BI-Bericht, weiterhin maskiert.",
      },
      {
        id: "govern",
        step: "Nachweis",
        title: "Nachweisen: Owner, Datenverträge und jeder Zugriff protokolliert",
        body: [
          "Eine verwaltete Tabelle hat einen Owner, Stewards und einen Custodian, eine Klassifizierung für jede Spalte und einen Status von Entwurf bis zertifiziert. Qualitätsregeln prüfen sie nach Zeitplan: fehlende Werte, ungültige IBANs, Duplikate, Zeilenzahlen oder beliebiges SQL. Die Vereinbarung lässt sich als ODCS-Datenvertrag exportieren.",
          "Die Nutzung zeigt, wer die Tabelle mit welchem Werkzeug liest; die Aktivität zeigt jeden Zugriff und jede Änderung, alter Wert neben neuem. Wenn die Prüferin oder die Datenschutzbeauftragte fragt, steht die Antwort schon da: Nachvollziehbarkeit statt Rekonstruktion.",
        ],
        facts: ["Owner, Stewards, Custodians", "Qualitätsregeln nach Zeitplan", "ODCS-Datenverträge", "Jeder Zugriff und jede Änderung protokolliert"],
        href: docs.governance,
        linkLabel: "Verwaltete Assets",
        media: "govern",
        caption: "Owner, Steward und Custodian zugewiesen, Zugriff gesetzt, eine Qualitätsregel ausgeführt, die Tabelle zertifiziert, der Vertrag exportiert.",
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
    lede: "Classifyre liest, worauf die Organisation läuft; die Branche entscheidet nur, welche Spalten personenbezogen sind, welche Zeilen jede Einheit sieht und wer sie im Klartext liest.",
    columns: {
      sector: "Branche",
      data: "Typische Daten",
      finds: "Was sich ändert",
    },
    rows: [
      {
        sector: "Öffentliche Hand · Länder · Städte",
        data: "Register, Akten, Statistik, Beschaffung",
        finds: "Jeder Bezirk, jede Abteilung, jede Magistratsabteilung sieht ihre eigenen Zeilen; personenbezogene Spalten kommen maskiert; die DSB liest das Protokoll",
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
        finds: "Wenn etwas abfließt: ein Fingerabdruck über Systeme, bearbeitet als Fall",
      },
    ],
    footnote:
      "Jede Zeile ist ein Einstieg, kein eigenes Produkt: darunter liegen dieselben Gruppen, Masken, Freigaben und dasselbe Zugriffsprotokoll.",
    links: [
      { label: "Berechtigungskonzept umsetzen", href: "/berechtigungskonzept-umsetzen" },
      { label: "Vorfallbearbeitung", href: routes.incidentResponse },
      { label: "Immuta-Alternative", href: "/immuta-alternative" },
      { label: "Unity-Catalog-Alternative", href: "/unity-catalog-alternative" },
      { label: "Zu den Fallakten", href: routes.blog + "/cases" },
    ],
  },

  convert: {
    marker: "Ihr Zug",
    title: "Starten Sie mit einer Abteilung und einer Quelle.",
    lede: "Ein Pilot über vier bis sechs Wochen bildet Ihre Gruppen und Regeln auf einem echten System ab. Ihre Technik kann dasselbe heute Abend mit einem Docker-Befehl starten, und alles, was sie einrichtet, kommt mit auf Kubernetes.",
    paths: [
      {
        label: "Ein Pilot mit einer Abteilung",
        text: "Vier bis sechs Wochen auf einem echten System: Ihre Verzeichnisgruppen abgebildet, Masken und Zeilenfilter aktiv, eine Power-BI-Verbindung und ein Zugriffsbericht, den Ihre Datenschutzbeauftragte abzeichnen kann. Fester Umfang, fester Preis.",
      },
      {
        label: "Heute Abend, auf Ihrem Rechner",
        text: "Ein Docker-Befehl. Quellen, Gruppen, Masken und das Zugriffsprotokoll bleiben lokal.",
      },
      {
        label: "Im großen Maßstab, auf Kubernetes",
        text: "Derselbe Kern als Helm-Chart: Worker skalieren zwischen den Läufen auf null. Ihr Team oder Ihr Integrator betreibt es; wenn Sie Hilfe bei Einrichtung, Installation oder Anpassung brauchen, kontaktieren Sie uns.",
      },
    ],
    ctaPrimary: "Pilot planen",
    ctaSecondary: "Auf einer Datenbank testen",
    ctaShowcase: "Live-Showcase ansehen",
    ctaBlog: "Die Feldnotizen lesen",
  },

  faq: {
    marker: "Klare Antworten",
    title: "Fragen, die wirklich gestellt werden.",
    lede: "",
    items: [
      {
        q: "Was ist Classifyre?",
        a: "Classifyre setzt Ihr Berechtigungskonzept auf allen Datenquellen durch: Zugriff nach Abteilung, Rolle und Regel, personenbezogene Daten maskiert, jeder Zugriff protokolliert, im eigenen Rechenzentrum. Es liest die 40+ Systeme, die Sie schon betreiben, direkt an der Quelle und stellt sie für SQL, Excel, Power BI und KI-Agenten bereit. Alles ist Open Source unter Apache-2.0.",
      },
      {
        q: "Wie nutzt Classifyre unsere Organisationsstruktur und AD-Gruppen?",
        a: "Die Anmeldung läuft über einen Identity-Server (Keycloak), der an Ihr Verzeichnis angebunden ist: Entra ID, Active Directory über LDAP, Okta oder jeden OIDC- oder SAML-Anbieter. Verzeichnisgruppen werden auf Gruppen in Classifyre abgebildet, und Zugriff geht immer an Gruppen: Data reader auf einen Workspace, eine Quelle oder eine Tabelle; Klartext für personenbezogene Spalten als eigene Freigabe; Zeilenfilter, die jeder Gruppe nur ihre Zeilen zeigen. Freigaben können ein Ablaufdatum haben. Wechselt jemand im Verzeichnis die Abteilung, folgt der Datenzugriff bei der nächsten Anmeldung.",
      },
      {
        q: "Ersetzt Classifyre unser Berechtigungskonzept?",
        a: "Nein, es setzt es durch. Ihr Berechtigungskonzept entscheidet weiterhin, wer was sehen darf. Classifyre sorgt dafür, dass diese Entscheidung auf den Daten selbst gilt, bei jeder Abfrage und in jedem Werkzeug, und protokolliert jeden Zugriff, damit Sie nachweisen können, dass sie gegolten hat.",
      },
      {
        q: "Können Teams auf Classifyre Datenprodukte bauen?",
        a: "Ja. Ein geteilter Datensatz verknüpft Tabellen aus verschiedenen Quellen zu einer benannten, gespeicherten Abfrage mit einer verantwortlichen Gruppe und Lesern pro Gruppe. Er liest die Quellen live, statt sie zu kopieren, und die Masken jeder Eingangstabelle reisen als Untergrenze mit, also zeigt ein Datenprodukt nie mehr, als seine Quellen erlauben. Ein SLA pro Datensatz gibt Classifyre nicht; es sorgt dafür, dass der Zugriff darum herum hält.",
      },
      {
        q: "Ist wirklich alles Open Source, auch SSO und Rollen?",
        a: "Ja. Jede Funktion steht unter Apache-2.0: Konnektoren, Erkennung, Maskierung, Freigaben, Zeilenfilter, der SQL-Endpunkt, das Zugriffsprotokoll, SSO, Rollen, Mandanten und Workspaces. Es gibt keine separate Enterprise-Version mit zusätzlichem Code. Wenn Sie Hilfe bei Einführung, Installation oder Anpassung brauchen, kontaktieren Sie uns — der Betrieb selbst oder mit Ihrem Integrator ist immer möglich.",
      },
      {
        q: "Ersetzt Classifyre unsere ETL- oder Datenprodukt-Werkzeuge?",
        a: "Nein. Behalten Sie Ihre ETL-Werkzeuge, Pipelines, dbt-Modelle und Datenprodukte. Classifyre baut und bewegt keine Daten: Es liest, was diese Werkzeuge erzeugen, direkt an der Quelle, und verwaltet es mit Klassifizierung, Ownern, Masken, Qualitätsregeln und Zugriff, jeder Lesezugriff protokolliert. Das funktioniert genauso in Open Source.",
      },
      {
        q: "Was unterscheidet Classifyre von Immuta, Unity Catalog oder Trino?",
        a: "Immuta ist ein kommerzielles Produkt, das Zugriffsrichtlinien in Cloud-Datenplattformen wie Snowflake und Databricks durchsetzt. Unity Catalog ist die Governance-Schicht von Databricks. Trino föderiert Abfragen und überlässt Ihnen Zugriffsregeln und Maskierung. Classifyre legt eine kontrollierte Zugriffsschicht über 40+ Systeme, Open Source, betrieben auf Ihrer Infrastruktur — On-Premises, in Ihrer eigenen Cloud oder auf Public-Cloud-Infrastruktur wie AWS, Azure oder Google Cloud: Zugriff nach Gruppe, Zeile und Spalte, Masken in der Abfrage und das Ergebnis in SQL, Excel und Power BI.",
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
        a: "Nirgendwohin. Classifyre läuft in Ihrem Netz und speichert alles in Ihrer eigenen PostgreSQL-Datenbank und Ihrem Speicher — On-Premises, in Ihrer eigenen Cloud oder auf Public-Cloud-Infrastruktur wie AWS, Azure oder Google Cloud. Abfragen laufen dort, wo die Daten liegen. Es läuft offline, und KI-Funktionen nutzen nur die Anbieter, die Sie konfigurieren, auch selbst betriebene Modelle.",
      },
      {
        q: "Läuft es auf Kubernetes?",
        a: "Am schnellsten starten Sie mit einem Docker-Image auf macOS, Windows oder Linux. Derselbe Kern kommt als Helm-Chart für Kubernetes, wo Worker als Jobs laufen und zwischen den Läufen auf null skalieren — On-Premises, in Ihrer eigenen Cloud oder auf Public-Cloud-Infrastruktur wie AWS, Azure oder Google Cloud. Wenn Sie Hilfe bei Einrichtung, Installation oder Anpassung brauchen, kontaktieren Sie uns.",
      },
    ],
  },

  incident: {
    metaTitle: "Vorfallbearbeitung bei Datenabfluss, Open Source",
    metaDescription:
      "Wenn personenbezogene Daten oder Secrets abfließen: gewichtete Befunde, Fingerabdrücke über Systeme, Fälle mit Hypothesen und ein Autopilot, der sich erklärt.",
    breadcrumb: "Vorfallbearbeitung",
    chip: "Anwendungsfall · Vorfallbearbeitung",
    titleLead: "Wenn etwas abfließt,",
    titleHighlight: "bearbeiten Sie es als Fall.",
    lede: "Kontrollierter Zugriff ist, was Sie jeden Tag betreiben. Die Ermittlung öffnen Sie an dem Tag, an dem eine Kundenliste per Mail hinausgeht oder ein Schlüssel in einem Build-Log auftaucht. Dieselben Befunde, denen die Masken folgen, speisen sie: stehende Anfragen, Fingerabdrücke über Systeme, Fälle mit Beweisstücken und konkurrierenden Hypothesen und ein Autopilot, der zwischen den Scans die Laufarbeit erledigt.",
    ctaPrimary: "Den Live-Fall ansehen",
    ctaSecondary: "Zu den Fallakten",
    points: {
      marker: "Was Sie bekommen",
      title: "Vom Befund zu einem Schluss, den Sie vertreten können.",
      items: [
        {
          title: "Anfragen",
          body: "Gespeicherte Fragen („PII verlässt das Unternehmen“), die Scan für Scan passende Befunde nach oben holen.",
          href: docs.inquiry,
        },
        {
          title: "Fingerabdrücke",
          body: "Deterministische Duplikat- und Ähnlichkeitserkennung, die dieselbe Datei oder denselben Datensatz über Systeme verknüpft.",
          href: docs.duplicates,
        },
        {
          title: "Fälle und Hypothesen",
          body: "Ein Arbeitsbereich, der Beweisstücke sammelt, konkurrierende Erklärungen abwägt und festhält, wie der Schluss zustande kam.",
          href: docs.cases,
        },
        {
          title: "Autopilot",
          body: "Agenten, die nach jedem Scan Anfragen öffnen, Fingerabdrücke pflegen, Fälle bauen und Hypothesen entwerfen, und protokollieren, was sie getan haben und warum.",
          href: docs.autopilot,
        },
      ],
      linkLabel: "Zur Dokumentation",
    },
    faq: [
      {
        q: "Ist Classifyre noch ein Ermittlungswerkzeug?",
        a: "Ja, für den Tag, an dem etwas abfließt. Fälle, stehende Anfragen, Fingerabdrücke über Quellen und der Autopilot sind alle da und Open Source. Kontrollierter Zugriff ist, was Sie jeden Tag betreiben; die Ermittlung ist, was Sie öffnen, wenn es darauf ankommt.",
      },
      {
        q: "Handelt der Autopilot selbstständig?",
        a: "Nur so weit, wie Sie es zulassen. Im Observe-only-Modus bleibt jede Aktion ein Vorschlag, den eine Person annimmt. Jeder Schritt protokolliert, was er getan hat und warum, und Agenten, die allein laufen, lesen nie Tabellenzeilen: Das kann nur das Token einer angemeldeten Person.",
      },
      {
        q: "Brauchen wir dafür den Governance-Teil?",
        a: "Nein. Quelle verbinden, Detektoren einschalten, und die Befunde speisen sofort Anfragen und Fälle. Masken, Freigaben und Zugriffsprotokoll sind da, wenn Sie sie wollen.",
      },
    ],
  },
};

export default de;
