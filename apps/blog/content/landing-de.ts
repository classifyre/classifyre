import type { LandingCopy } from "./landing";

import { docs } from "@/lib/site";

/**
 * German landing-page copy: a full translation of `en` in `./landing.ts`,
 * type-checked against `LandingCopy` so a missing string fails the build.
 * Links reuse the same shared URL constants as the English copy.
 */

/* ── Hero ───────────────────────────────────────────────────────────────── */

const deHero = {
  /** Small stamps above the headline. */
  chips: ["Open-Source-Ermittlungsplattform"],
  titleA: "Der Spur folgen.",
  /** Rendered as `titleBLead` + an accent block with `titleBHighlight`. */
  titleBLead: "Fall",
  titleBHighlight: "schließen.",
  lede: "Classifyre liest die Systeme, die Sie bereits betreiben, findet die von Ihnen definierten Signale, und verfolgt sie dann über Quellen hinweg, wie ein Detektiv, während ein KI-Autopilot die Laufarbeit zwischen den Scans übernimmt.",
  ctaPrimary: "Auf Ihrer Maschine betreiben",
  ctaSecondary: "Live-Showcase ausprobieren",
  micro: "Keine Anmeldung. Ein Docker-Befehl. Ihre Daten bleiben bei Ihnen.",
  /** The pinned case file beside the headline. */
  exhibit: {
    tab: "Fallakte · 042",
    stamp: "Fall eröffnet",
    subject: "Beweisstück A: der Ermittler",
    status: "Im Dienst",
  },
} as const;
/** Alt text for the hand-inked investigator drawings. */
const deMascots = {
  questioning:
    "Der Classifyre-Ermittler im Trenchcoat kratzt sich am Kopf über ein unbeantwortbares Fragezeichen",
  lookingAround:
    "Der Classifyre-Ermittler schaut sich um und sucht die Spur",
  lookingAtYou: "Der Classifyre-Ermittler sieht Sie direkt an",
  hiddenGem:
    "Der Classifyre-Ermittler hält eine Lupe über einen verborgenen Fund",
} as const;


/* ── Install strip ──────────────────────────────────────────────────────── */

const deInstall = {
  marker: "Hier starten",
  title: "Ein Befehl heute Nacht. Derselbe Kern in beliebiger Größe.",
  lede: "Das All-in-one-Image enthält Datenbank, UI und Scan-Worker; alles bleibt auf Ihrer Maschine. Das Helm-Chart betreibt denselben Kern auf Kubernetes, wenn Ihr Bestand wächst.",
  dockerLabel: "All-in-one-Image · kostenlos · keine Anmeldung",
  dockerTitle: "Dort betreiben, wo Sie arbeiten",
  dockerCta: "Setup & Konfiguration",
  helmLabel: "Helm-Chart · skaliert beliebig",
  helmTitle: "Oder auf Kubernetes betreiben",
  helmCopy:
    "Ephemere Scan-Worker skalieren zwischen den Läufen auf null und fächern so weit auf, wie Ihr Bestand reicht. Ihr Cluster, Ihre Daten.",
  helmCtaDocs: "Helm-Chart-Doku",
  helmCtaRepo: "Chart-README auf GitHub",
} as const;

/* ── Problem / tension ──────────────────────────────────────────────────── */

const deTension = {
  marker: "Das Problem",
  title: "Jedes System hält einen Fakt. Keines hält die Geschichte.",
  lede: "Eine Sendung ging an die falsche Adresse. Das ERP kennt die Bestellung, das Support-Tool kennt die Beschwerde, der Rechnungslauf kennt das Geld. Jedes für sich ist Rauschen. Zusammen sind sie ein Fall, und heute kann sie niemand zusammensetzen.",
  /** Margin notes: the three ways the story stays buried. */
  notes: [
    {
      label: "Feldnotiz 01",
      title: "Exporte gehen nicht auf",
      body: "Zeilen verlieren ihre Verknüpfungen, sobald sie die Datenbank verlassen. Sechs CSVs später sind die Beziehungen weg, und jede Frage beginnt die Prüfung bei null.",
    },
    {
      label: "Feldnotiz 02",
      title: "Befundtabellen enden in der Sackgasse",
      body: "Ein Scanner listet 4.000 Secrets auf und hört auf. Das Sortieren bleibt Ihre Aufgabe, und jeder Rescan fügt still ein paar hundert weitere hinzu.",
    },
    {
      label: "Feldnotiz 03",
      title: "Niemand weiß, woher man es wusste",
      body: "Wenn eine Aufsichtsbehörde, ein Gericht oder ein CFO fragt, was Sie wann wussten, ist „das Modell hat das gesagt“ keine Antwort. Beweise ohne Lineage sind ein Gerücht.",
    },
  ],
  kicker:
    "Es hat jedes Mal dieselbe Form: jemand im Unternehmen, der eine Tabelle weiterleitet, um zu helfen, eine Gegenpartei drei Scheinfirmen tief, ein Betrugsmuster über fünf Fachsysteme verteilt. Verstreute Fakten. Eine Geschichte.",
  figureCaption:
    "Abb. 01: sechs Systeme, eine Geschichte, keine Verbindung zwischen den Fakten",
} as const;

/* ── Method / solution ──────────────────────────────────────────────────── */

const deMethod = {
  marker: "Die Methode",
  title: "Ein Faden durch jedes System.",
  lede: "Classifyre ist weniger ein Business-Intelligence-Werkzeug als eine operative Datenschicht: Es verbindet die Systeme, die Sie bereits betreiben, modelliert die realen Entitäten und Beziehungen darin und hält einen Faden vom ersten Treffer bis zum geschlossenen Fall.",
  stages: [
    {
      no: "01",
      word: "Lesen",
      title: "Die Systeme lesen, die Sie bereits betreiben",
      body: "Datenbanken, Lakehouses, Kollaborationstools, Storage, Streams und öffentliche Register. Scans nehmen Assets nach Zeitplan auf, und alles Gefundene landet in einem Beweisstrom.",
      href: "/de/sources/",
      linkLabel: "Quellenkatalog ansehen",
    },
    {
      no: "02",
      word: "Signal",
      title: "Definieren, was zählt (in Ihren Worten)",
      body: "Regex und Regeln für die deterministischen Dinge, Entitätsklassifizierung mit Ihren Labels, jedes Hugging-Face-Modell, oder ein Prompt, der zum Detektor wird. Mitgelieferte Packs decken PII, Secrets, Code-Security und Inhaltsqualität ab, ab dem ersten Scan.",
      href: docs.detectors,
      linkLabel: "Detektor-Packs ansehen",
    },
    {
      no: "03",
      word: "Verfolgen",
      title: "Über Quellen hinweg verfolgen",
      body: "Fingerprints verbinden denselben Fakt, wo immer er auftaucht. Near-Duplicates kommen nach Ursache gruppiert, und Lineage hält den Faden vom ersten bis zum letzten Treffer zusammen.",
      href: docs.duplicates,
      linkLabel: "So funktionieren Fingerprints und Duplikate",
    },
    {
      no: "04",
      word: "Ablegen",
      title: "Aus Befunden einen Fall machen",
      body: "Stehende Anfragen matchen weiter frische Beweise. Befunde werden von 0 bis 1 gereiht, mit aufgeschriebenen Gründen. Ein Fall sammelt die Beweise, die konkurrierenden Hypothesen, einen Owner und einen Audit-Trail, den Sie übergeben können.",
      href: docs.cases,
      linkLabel: "So funktionieren Fälle",
    },
    {
      no: "05",
      word: "Arbeiten",
      title: "Die Laufarbeit dem Autopiloten überlassen",
      body: "Zwischen den Scans wachen fünf Agenten der Reihe nach auf: Anfragen matchen, Fälle eröffnen, tote Quellen wecken, den fehlenden Detektor entwerfen, Memory konsolidieren. Observe-only einschalten, und alles bleibt ein Vorschlag.",
      href: docs.autopilot,
      linkLabel: "So funktioniert der Autopilot",
    },
  ],
} as const;


/* ── Interactive demo ───────────────────────────────────────────────────── */

const deDemo = {
  marker: "Akte öffnen",
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



/* ── Sectors ────────────────────────────────────────────────────────────── */

const deSectors = {
  marker: "Wo es landet",
  title: "Die Akten sehen anders aus. Die Methode ist dieselbe.",
  lede: "Classifyre liest, worauf Ihr Betrieb läuft; der Sektor entscheidet nur, welche Signale Sie zuerst definieren.",
  columns: {
    sector: "Sektor",
    data: "Typische Daten",
    finds: "Was verfolgt wird",
  },
  rows: [
    {
      sector: "Finanzen · KYC · AML",
      data: "Kundenstamm, Transaktionen, Sanktionen, Kontonetzwerke",
      finds: "Geschichtete Gegenparteien, ein sanktionierter Name unter neuem Namen wieder aufgetaucht",
    },
    {
      sector: "Betrieb im Gesundheitswesen",
      data: "Aufnahmen, Verlegungen, OP-Pläne, Personal, Bestand",
      finds: "Kapazitätslecks, Wartelisten-Muster, Bestandsdrift",
    },
    {
      sector: "Energie · Versorger",
      data: "SCADA, Sensoren, GIS, Wartung, Marktdaten",
      finds: "Sensor-Drift vor Ausfällen, stille Ausfälle, Vertragsanomalien",
    },
    {
      sector: "Lieferkette · Logistik",
      data: "ERP-Bestellungen, Bestand, Sendungen, Lieferantendaten",
      finds: "Sendungen an die falsche Adresse, Geisterbestand, Lieferanten-Überschneidungen",
    },
    {
      sector: "Transportwesen",
      data: "Wartungslogs, technische Aufzeichnungen, Bodenbetrieb",
      finds: "Zurückgestellte Mängel, Teileherkunft, nicht erfasste Arbeiten",
    },
    {
      sector: "Telekommunikation",
      data: "Netzwerktopologie, Telemetrie, Incidents, Außendienst",
      finds: "Routen-Missbrauch, SLA-Verletzungen, bevor die Beschwerden kommen",
    },
    {
      sector: "Handel · POS · SKU",
      data: "Verkäufe, Aktionen, Bestand, Retouren, Wettbewerbspreise",
      finds: "Schwund, Aktions-Missbrauch, Retourenbetrug",
    },
    {
      sector: "Strafverfolgung · Zivilermittlung",
      data: "Fallakten, Personen und Organisationen, Finanz- und Reisedaten",
      finds: "Eine Entität unter drei Namen, ein Faden durch fünf Fachsysteme",
    },
    {
      sector: "Behörden · öffentlicher Sektor",
      data: "Vergabe, Register, Korrespondenz, Förderungen",
      finds: "Nicht deklarierte Interessen, Ausschreibungsmuster, geleakte Dokumente",
    },
    {
      sector: "Interne Revision · Compliance",
      data: "Zugriffslogs, Verträge, Spesen, Kommunikation",
      finds: "Der Leak, der Interessenkonflikt, die Kontrolle, die nicht mehr funktioniert",
    },
  ],
  footnote:
    "Die Datenschemata der Sektoren stammen aus der veröffentlichten Caseliteratur operativer Datenplattformen; die im Kategorie-Kontext genannten Ergebniszahlen sind Palantirs veröffentlichte Ergebnisse, als Marktkontext angeführt, nicht als Classifyre-Ergebnisse.",
} as const;


/* ── Conversion ─────────────────────────────────────────────────────────── */

const deConvert = {
  marker: "Sie sind dran",
  title: "Eröffnen Sie Ihren ersten Fall heute Nacht.",
  lede: "Richten Sie es auf ein System, das Sie bereits betreiben, und sehen Sie, was der Ermittler findet. Alles, was Sie aufbauen, tragen Sie mit, wenn Sie mit Helm remote gehen.",
  paths: [
    {
      label: "Heute Nacht, auf Ihrer Maschine",
      text: "Ein Docker-Befehl. Quellen, Befunde und Fälle bleiben lokal.",
    },
    {
      label: "Skaliert, auf Kubernetes",
      text: "Derselbe Kern als Helm-Chart: Scan-Worker skalieren zwischen den Läufen auf null.",
    },
    {
      label: "Wenn es zur Infrastruktur wird",
      text: "Enterprise ergänzt SSO, Rollen, Autorisierung pro Workspace, abgestimmte Modelle und unsere Engineers. Bis dahin brauchen Sie nur das hier.",
    },
  ],
  ctaPrimary: "Setup & Konfiguration",
  ctaSecondary: "Live-Showcase ausprobieren",
  ctaEnterprise: "Sprechen Sie mit uns über Enterprise",
  ctaBlog: "Feldnotizen lesen",
} as const;

/* ── FAQ ────────────────────────────────────────────────────────────────── */

const deFaq = {
  marker: "Klare Antworten",
  title: "Fragen, die Menschen wirklich stellen.",
  lede: "",
  items: [
    {
      q: "Was ist eine Ermittlungsplattform?",
      a: "Sie ist die Schicht zwischen den Systemen, die Sie betreiben, und einer Entscheidung, die Sie verteidigen müssen. Classifyre liest diese Systeme, findet die von Ihnen definierten Signale, verfolgt sie über Quellen hinweg und macht aus den Beweisen Fälle mit Hypothesen, Ownern und Audit-Trail, statt Sie mit einer Befundtabelle und viel Glück zurückzulassen.",
    },
    {
      q: "Ist Classifyre wirklich kostenlos und Open Source?",
      a: "Der Open-Source-Kern ist kostenlos betreibbar und kostenlos lesbar: Source-Connectors, Detektor-Packs, eigene Detektion, Ranking, Duplikate, Fälle und der KI-Autopilot stecken alle darin. Die Enterprise-Edition ergänzt Governance und Services: SSO, Rollen, Autorisierung pro Workspace, auf Ihre Terminologie abgestimmte Detektion und unsere Engineers für Rollout und Support.",
    },
    {
      q: "Worin unterscheidet sich Classifyre von Palantir Foundry oder Gotham?",
      a: "Es ist dieselbe Produktkategorie: eine operative Datenschicht über fragmentierte Quellsysteme, mit Fällen und KI obendrauf. Palantir hat die Kategorie im großen Maßstab bewiesen, geschlossen. Classifyre ist Open Source, selbst gehostet, aus der EU und so dimensioniert, dass ein Team ohne Programmoffice starten kann.",
    },
    {
      q: "Welche Datenquellen kann es lesen?",
      a: "Operative Datenbanken, Lakehouses, Kollaborationstools, Object Storage, Streams und öffentliche Inhalte; jeder Connector ist ein dokumentierter Quellentyp, und der Katalog wächst in der Öffentlichkeit. Fehlt eine Quelle, werden eigene Quellen unterstützt, und das Enterprise-Team baut sie gemeinsam mit Ihnen.",
    },
    {
      q: "Läuft es auf Kubernetes?",
      a: "Ja. Der schnellste Start ist ein einzelnes All-in-one-Docker-Image, das auf macOS, Windows und Linux läuft; derselbe Kern erscheint als Helm-Chart, wo Scan-Worker als ephemere Jobs laufen, die zwischen den Läufen auf null skalieren. Alles, was Sie lokal aufbauen, tragen Sie mit.",
    },
    {
      q: "Wohin gehen meine Daten? Verlässt etwas unsere Infrastruktur?",
      a: "Nirgendwohin. Classifyre läuft innerhalb Ihres Bestands und speichert alles in Ihrer eigenen PostgreSQL-Datenbank und Ihrem Storage. KI-Funktionen laufen gegen Provider, die Sie konfigurieren (auch Modelle, die Sie selbst hosten) und der Autopilot lässt sich auf Observe-only umstellen.",
    },
    {
      q: "Was bringt die Enterprise-Edition?",
      a: "Zuerst Governance: SSO, Rollen und Autorisierung pro Workspace, damit eine Instanz mehrere Teams oder Fälle ohne Überschneidung bedienen kann. Dann auf Ihre Terminologie abgestimmte Detektion, eigene Detektoren und Quellen für die Daten Ihrer Branche, Mehrsprachen-Tuning, Architektur-Reviews, Upgrade-Hilfe und Support mit SLA.",
    },
    {
      q: "Brauche ich Data Scientists, um es zu benutzen?",
      a: "Nein. Mitgelieferte Detektor-Packs greifen beim ersten Scan, eigene Detektion beginnt bei Regex, und der Autopilot entwirft Detektoren für Sie. Data Engineers und Scientists bekommen Tiefe (Schemas, Modelle, einen MCP-Endpunkt, um das ganze Produkt vom eigenen KI-Client aus zu steuern) ohne dass das die Eintrittsgebühr ist.",
    },
  ],
} as const;

const de: LandingCopy = {
  hero: deHero,
  install: deInstall,
  tension: deTension,
  method: deMethod,
  mascots: deMascots,
  demo: deDemo,
  sectors: deSectors,
  convert: deConvert,
  faq: deFaq,
};

export default de;
