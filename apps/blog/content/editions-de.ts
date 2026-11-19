import type { EditionsCopy } from "./editions";

/**
 * German copy for /open-source-vs-enterprise: a full translation of `en` in
 * `./editions.ts`, type-checked against `EditionsCopy`. `oss` / `ent` cells
 * keep their booleans as booleans; only the short "degree, not presence"
 * strings are words.
 */

const de: EditionsCopy = {
  hero: {
    mark: "Open Source und Enterprise",
    titleA: "Gleiche Engine.",
    titleBLead: "Anderer",
    titleBHighlight: "Raum.",
    lede: "Jede Funktion ist Open Source, auch SSO, Rollen und Maskierung. Betreiben Sie es selbst oder mit Ihrem Integrator. Enterprise ist dasselbe Produkt, auf Ihre Organisation zugeschnitten, mit Support und SLA dahinter.",
    ctaPrimary: "Classifyre holen",
    ctaSecondary: "Pilot-Gespräch vereinbaren",
  },
  editions: {
    mark: "Auf einen Blick",
    title: "Ein Produkt. Zwei Arten, es zu betreiben.",
    lede: "Das Open-Source-Repository ist das ganze Produkt. Behalten Sie Ihre ETL-Werkzeuge, Pipelines und Datenprodukte; Classifyre verwaltet, was sie erzeugen, in beiden Editionen. Enterprise bringt Zuschnitt und jemanden, der Verantwortung übernimmt, nie eine Funktion hinter einem Lizenzschlüssel.",
    core: {
      eyebrow: "Open Source, für immer kostenlos",
      title: "Open Source",
      body: "Jeder Konnektor, jeder Detektor, jede Maske, Freigabe und Protokollzeile, unter Apache-2.0. Auf dem Laptop oder im Cluster, so lange Sie wollen, ohne Nutzerzahl und ohne Ablauf.",
      points: [
        "Erkennung von PII und Secrets in über 40 Quelltypen",
        "Spaltenmasken, Freigaben, Zeilenfilter und Zugriffsanfragen",
        "SQL, Exporte und ein PostgreSQL-Endpunkt für Power BI und Excel",
        "SSO, Rollen, Mandanten, Workspaces und das Protokoll jedes Zugriffs",
      ],
      ctaPrimary: "Holen",
      ctaSecondary: "Quellcode lesen",
    },
    governed: {
      eyebrow: "Enterprise, auf Ihre Organisation zugeschnitten",
      title: "Enterprise",
      body: "Derselbe Code, so geformt, wie Ihre Organisation arbeitet: Ihr Identity Provider und Ihre Gruppen, Ihr Zugriffsmodell, Ihre Fachsprache und Modelle. Eingeführt von Ihrem Team, Ihrem Integrator oder uns, und betreut, wenn es darauf ankommt.",
      points: [
        "Ihre ETL und Datenprodukte bleiben; Classifyre verwaltet, was sie erzeugen",
        "Governance nach Maß für Ihre Organisation",
        "Erkennungsmodelle für Ihre Daten, auf Ihrer Hardware",
        "OpenShift-Betreuung und ein SLA",
      ],
      ctaPrimary: "Pilot-Gespräch vereinbaren",
    },
  },
  mascots: {
    lookingAtYou: "Der Classifyre-Ermittler sieht Sie direkt an",
    hiddenGem:
      "Der Classifyre-Ermittler hält eine Lupe über einen verborgenen Fund",
  },
  engagement: {
    marker: "Was Sie kaufen können",
    title: "Pilot, Einführungshilfe, Abonnement.",
    lede: "Sie brauchen uns nicht, um es zu betreiben: Viele Teams führen es allein oder mit ihrem Integrator ein. Wenn Sie Hilfe wollen, wird pro Umgebung abgerechnet, nicht pro Nutzer: Self-Service ist der Zweck, mehr Lesende dürfen nie mehr kosten.",
    steps: [
      {
        no: "01",
        title: "Pilot",
        body: "4 bis 6 Wochen, fester Umfang, Festpreis. Ein Workspace, 3 bis 5 Quellen, Erkennung auf Ihre Daten abgestimmt, Maskierung aktiv, eine BI-Anbindung und ein Fund- und Zugriffsbericht.",
      },
      {
        no: "02",
        title: "Einführungshilfe",
        body: "Für Ihr Team oder Ihren Integrator, so viel oder so wenig wie nötig: SSO und Gruppen-Mapping (Entra ID, Keycloak, LDAP), das Zugriffsmodell, Konnektoren und Netzwerk, Installation auf Kubernetes oder OpenShift, Schulung für Admins und Stewards.",
      },
      {
        no: "03",
        title: "Abonnement mit SLA",
        body: "Betreute Releases und Sicherheitspatches, veröffentlichte Reaktionszeiten zu Geschäftszeiten, ein benannter Ingenieur, Update-Begleitung, ein quartalsweiser Health-Check und Mitsprache bei der Roadmap.",
      },
      {
        no: "04",
        title: "Anpassung",
        body: "Detektoren und Modelle für Ihre Fachsprache und deutschsprachige Dokumente, österreichische Kennungen, Branchenquellen, eigene Masken, Untersuchungsfälle und Berichte für Ihre Prüfer.",
      },
    ],
  },
  comparison: {
    mark: "Zeile für Zeile",
    title: "Der ganze Vergleich",
    lede: "Jede Funktionszeile ist auf beiden Seiten abgehakt. Der Unterschied sind Menschen.",
    caption: "Vergleich zwischen Classifyre Open Source und Classifyre Enterprise",
    columns: {
      capability: "Fähigkeit",
      oss: "Open Source",
      ent: "Enterprise",
    },
    included: "Enthalten",
    excluded: "Nicht enthalten",
    groups: [
      {
        group: "Erkennung",
        summary: "Identisch. Die Engine ist das Open-Source-Projekt.",
        rows: [
          {
            capability: "Jeder Quell-Konnektor",
            detail: "Datenbanken, Lakehouses, Kollaborationswerkzeuge, Speicher, Streams",
            oss: true,
            ent: true,
          },
          {
            capability: "Detektoren für PII und Secrets",
            detail: "41 PII-Arten inkl. EU-Kennungen; 27 Secret-Muster",
            oss: true,
            ent: true,
          },
          {
            capability: "Eigene Detektoren",
            detail: "Regex, Entitätsmodelle, Hugging-Face-Modelle, beliebige LLMs",
            oss: true,
            ent: "Mit Ihnen gebaut",
          },
          {
            capability: "Modelle für Ihre Fachsprache",
            detail: "Auf Ihrer Hardware, für Ihre Sprachen und Dokumente",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Schutz und Zugriff",
        summary: "Identisch. Governance steckt im Kern, nicht hinter einem Schlüssel.",
        rows: [
          {
            capability: "Spaltenmasken",
            detail: "Geschwärzt, letzte vier, gehasht, leer, ausgeblendet; standardmäßig maskiert",
            oss: true,
            ent: true,
          },
          {
            capability: "Freigaben, Zeilenfilter und Zugriffsanfragen",
            detail: "Pro Gruppe, Quelle und Tabelle, mit Ablaufdatum",
            oss: true,
            ent: true,
          },
          { capability: "Single Sign-on (SSO) und Rollen", oss: true, ent: true },
          {
            capability: "Mandanten und Berechtigung pro Workspace",
            oss: true,
            ent: true,
          },
          {
            capability: "Protokoll jedes Lesezugriffs",
            detail: "Wer, welche Tabelle, welches Werkzeug, wann",
            oss: true,
            ent: "An Ihr SIEM angebunden",
          },
          {
            capability: "Governance-Blueprint",
            detail: "Ein schriftliches Zugriffsmodell, das Ihre DSB unterschreiben kann",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Nutzung",
        summary: "Identisch.",
        rows: [
          { capability: "SQL-Seite, Exporte, geteilte Datasets", oss: true, ent: true },
          {
            capability: "PostgreSQL-Endpunkt",
            detail: "Power BI, Excel, Tableau, DBeaver",
            oss: true,
            ent: true,
          },
          {
            capability: "Fälle, Anfragen, Lineage und Autopilot",
            oss: true,
            ent: "Fälle für Ihre Vorfälle",
          },
          { capability: "MCP-Endpunkt für KI-Agenten", oss: true, ent: true },
        ],
      },
      {
        group: "Betrieb",
        summary: "Keine Laufzeit wird zurückgehalten; OpenShift kommt mit uns.",
        rows: [
          {
            capability: "All-in-one-Docker-Image",
            detail: "macOS, Windows, Linux; PostgreSQL inklusive",
            oss: true,
            ent: true,
          },
          { capability: "Helm-Chart auf Kubernetes", oss: true, ent: true },
          {
            capability: "OpenShift",
            detail: "Installation und Betreuung durch unsere Ingenieure",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Menschen",
        summary: "Wofür Sie zahlen.",
        rows: [
          { capability: "Support", oss: "GitHub-Issues", ent: "SLA, benannter Ingenieur" },
          {
            capability: "Einführung",
            oss: "Dokumentation und Showcase",
            ent: "Pilot und Umsetzung",
          },
          {
            capability: "Einfluss auf die Roadmap",
            oss: "Offene Issues und Pull Requests",
            ent: "Ein Platz am Tisch",
          },
          {
            capability: "Preis",
            oss: "Kostenlos, für immer",
            ent: "Pro Umgebung, nicht pro Nutzer",
          },
        ],
      },
    ],
    workspaceNote:
      "SSO, Rollen, Mandanten und Berechtigungen pro Workspace waren früher Enterprise-Funktionen. Jetzt sind sie Open Source, weil einem Governance-Werkzeug, dessen Zugriffskontrolle ein kostenpflichtiges Add-on ist, in der Beschaffung niemand vertrauen kann.",
    workspaceCta: "Rollen in der Dokumentation",
  },
  extras: {
    title: "Für größere Umgebungen",
    lede: "Was Behörden, Banken und Spitäler meist als Nächstes fragen. Jedes davon ist Teil eines Abonnements oder eines Arbeitspakets zum Festpreis.",
    items: [
      {
        title: "Zugriffsprotokoll ins SIEM",
        body: "Jeder Lesezugriff und jede Änderung an Splunk, Elastic oder Sentinel geliefert.",
      },
      {
        title: "Releases mit Langzeitsupport",
        body: "Eine Release-Linie mit nachgezogenen Sicherheitskorrekturen, für Änderungsfenster in Quartalen.",
      },
      {
        title: "Air-Gapped-Installation",
        body: "Signierte Images, eine Software-Stückliste (SBOM) und ein Offline-Paket für Netze ohne Internet.",
      },
      {
        title: "Compliance-Dokumentation",
        body: "Verarbeitungsverzeichnis, Nachweise zu Art. 25 DSGVO und Kontroll-Mappings, mit denen Ihre Prüfer arbeiten können. Dokumentation, kein Zertifikat.",
      },
      {
        title: "Vergabefähige Verträge",
        body: "Ein Pilot in der Größe einer Direktvergabe, EVB-IT-Vorlagen für Deutschland und ein Integrator als Generalunternehmer, wo nötig.",
      },
      {
        title: "Schulung",
        body: "Für Admins, Stewards und Datenschutzbeauftragte: wer was entscheidet und wie man das Protokoll liest.",
      },
    ],
  },
  closing: {
    titleLead: "Kostenlos starten.",
    titleHighlight: "Für den Rest anrufen.",
    lede: "Die meisten Teams starten mit dem Open-Source-Image und betreiben es selbst oder mit ihrem Integrator. Sprechen Sie mit uns, wenn Sie es auf Ihre Organisation zuschneiden wollen oder jemanden mit Verantwortung dahinter brauchen.",
    ctaPrimary: "Classifyre holen",
    ctaSecondary: "Pilot-Gespräch vereinbaren",
    ctaTertiary: "Oder zuerst den Live-Showcase ansehen",
  },
};

export default de;
