import type { EditionsCopy } from "./editions";

/**
 * German copy for /open-source-vs-enterprise: a full translation of `en` in
 * `./editions.ts`, type-checked against `EditionsCopy`. `oss` / `ent` cells
 * keep their booleans as booleans; only the short "degree, not presence"
 * strings are words.
 */

const de: EditionsCopy = {
  hero: {
    mark: "Open Source vs. Enterprise",
    titleA: "Gleiche Engine.",
    titleBLead: "Anderer",
    titleBHighlight: "Raum.",
    lede: "Der Open-Source-Kern ist das ganze Produkt, kein Trichter in ein Bezahlprodukt. Was Enterprise verkauft, sind Governance, Tuning und Menschen; die Dinge, die eine große Organisation wirklich nicht selbst bedienen kann.",
    ctaPrimary: "Den Kern holen",
    ctaSecondary: "Gespräch beginnen",
  },
  editions: {
    mark: "Auf einen Blick",
    title: "Zwei Editionen. Eine Engine.",
    lede: "Detektion, Ermittlung und Deployment sind vollständig Open Source. Enterprise legt das Schloss am Schrank dazu und die Engineers, die Ihre Domäne kennen.",
    core: {
      eyebrow: "Open Source · für immer kostenlos",
      title: "Kern",
      body: "Alles, was detektiert, ermittelt und deployt. Auf einem Laptop oder clusterweit betreiben, so lange Sie wollen, ohne Seat-Count und ohne Ablauf.",
      points: [
        "Jeder Konnektor, jedes Detektor-Pack und jede Custom-Detektor-Stufe",
        "Anfragen, Fingerprints, Fälle und der Harness-AI-Autopilot",
        "Docker-Image und Helm-Chart, beide voll ausgestattet",
        "Workspace-Isolierung steckt im Kern und ist immer an",
      ],
      ctaPrimary: "Holen",
      ctaSecondary: "Quellcode lesen",
    },
    governed: {
      eyebrow: "Enterprise · eine Partnerschaft",
      title: "Gesteuert",
      body: "Der Kern plus das Schloss am Schrank, und Engineers, die Ihre Domäne lernen. Unsere Leute arbeiten mit Ihrem Team ab dem ersten Piloten, statt einen Lizenzschlüssel zu überreichen.",
      points: [
        "SSO, Rollen und Autorisierung pro Workspace",
        "Modelle, abgestimmt auf Ihre Terminologie und Sprachen",
        "Detektoren und Quellen, gebaut für die Daten Ihrer Branche",
        "Architektur-Reviews, OpenShift, Support mit SLA",
      ],
      ctaPrimary: "Gespräch beginnen",
    },
  },
  mascots: {
    lookingAtYou: "Der Classifyre-Ermittler sieht Sie direkt an",
    hiddenGem:
      "Der Classifyre-Ermittler hält eine Lupe über einen verborgenen Fund",
  },
  engagement: {
    marker: "Wie wir arbeiten",
    title: "Eine Partnerschaft, kein Lizenzschlüssel.",
    lede: "Unsere Engineers arbeiten ab dem ersten Pilot mit Ihrem Team. Wir lernen, wie Ihr Unternehmen Dinge benennt, und stimmen Classifyre darauf ab, wie Ihre Firma tatsächlich arbeitet.",
    steps: [
      {
        no: "01",
        title: "Pilot",
        body: "Wir wählen gemeinsam eine echte Ermittlung und führen sie auf Ihren Daten, in Ihrem Bestand, durch.",
      },
      {
        no: "02",
        title: "Architektur-Review",
        body: "Ihr Cluster, Ihr Identity-Provider, Ihre Datenbank. Das Deployment wird geprüft, bevor es zur Infrastruktur wird.",
      },
      {
        no: "03",
        title: "Abgestimmte Detektion",
        body: "Modelle und Detektoren, abgestimmt auf Ihre Terminologie und die Daten Ihrer Branche, gebaut von unseren Engineers gemeinsam mit Ihren.",
      },
      {
        no: "04",
        title: "Rollout und Support",
        body: "Upgrade-Hilfe, OpenShift, Support mit SLA und benannte Engineers, die Ihre Fälle kennen.",
      },
    ],
  },
  comparison: {
    mark: "Zeile für Zeile",
    title: "Der gesamte Vergleich",
    lede: "Vier der fünf Gruppen unten sind zwischen den Editionen identisch.",
    caption:
      "Feature-Vergleich zwischen dem Classifyre-Open-Source-Kern und der Enterprise-Edition",
    columns: {
      capability: "Funktion",
      oss: "Open Source",
      ent: "Enterprise",
    },
    included: "Enthalten",
    excluded: "Nicht enthalten",
    groups: [
      {
        group: "Detektion",
        summary: "Identisch. Die Engine ist das Open-Source-Projekt.",
        rows: [
          {
            capability: "Jeder Quellen-Konnektor",
            detail:
              "Datenbanken, Lakehouses, Kollaborationstools, Storage, Streams",
            oss: true,
            ent: true,
          },
          {
            capability: "Eingebaute Detektor-Packs",
            detail: "PII, Secrets, Code-Security, Threats, Content-Qualität",
            oss: true,
            ent: true,
          },
          {
            capability: "Eigene Detektoren",
            detail:
              "Regex, Entitäts-Klassifizierung, Hugging-Face-Modelle, jedes LLM",
            oss: true,
            ent: "Mit Ihnen gebaut",
          },
          {
            capability: "Semantisches Ranking",
            detail:
              "Wichtigkeit 0–1 mit aufgeschriebenen Gründen, nicht nur Severity",
            oss: true,
            ent: "Auf Ihren Korpus kalibriert",
          },
          {
            capability: "Detektion abgestimmt auf Ihre Terminologie",
            detail:
              "Modelle, trainiert, damit ein Begriff bedeutet, was er in Ihrer Firma bedeutet",
            oss: false,
            ent: true,
          },
          {
            capability: "Mehrsprachiges Detektions-Tuning",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Ermittlung",
        summary: "Identisch. Fälle sind das Produkt, in beiden Editionen.",
        rows: [
          {
            capability: "Befunde, Anfragen und Fingerprints",
            oss: true,
            ent: true,
          },
          {
            capability: "Fälle, Hypothesen und Beweisspuren",
            oss: true,
            ent: true,
          },
          {
            capability: "Harness-AI-Autopilot",
            detail: "Fünf Agenten bearbeiten die Ermittlung zwischen den Scans",
            oss: true,
            ent: "Auf Ihre Workflows abgestimmt",
          },
          {
            capability: "In-App-Assistent und MCP-Server",
            detail: "Das ganze Produkt aus Ihrem eigenen KI-Client steuern",
            oss: true,
            ent: true,
          },
          {
            capability: "Benachrichtigungen und Datenexport",
            oss: true,
            ent: true,
          },
        ],
      },
      {
        group: "Deployment",
        summary: "Identisch. Keine Runtime wird zurückgehalten.",
        rows: [
          {
            capability: "All-in-one-Docker-Image",
            detail: "macOS, Windows, Linux; PostgreSQL drinnen",
            oss: true,
            ent: true,
          },
          {
            capability: "Helm-Chart auf Kubernetes",
            detail: "Skaliert so weit, wie der Bestand verlangt",
            oss: true,
            ent: true,
          },
          {
            capability: "Workspace-Isolierung",
            detail:
              "Eigenes Schema, eigene Beweise, eigenes KI-Memory und eigener Endpunkt pro Workspace",
            oss: true,
            ent: true,
          },
          {
            capability: "OpenShift",
            detail: "Mit Upgrade-Hilfe unserer Engineers",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Governance",
        summary: "Der echte Unterschied: das Schloss am Schrank.",
        rows: [
          { capability: "Single Sign-on (SSO)", oss: false, ent: true },
          { capability: "Rollen und Berechtigungen", oss: false, ent: true },
          {
            capability: "Autorisierung pro Workspace",
            detail: "Ein Auditor öffnet den Audit-Workspace und sonst nichts",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Menschen",
        summary: "Was Sie außer Software bekommen.",
        rows: [
          {
            capability: "Support",
            oss: "GitHub-Issues",
            ent: "Mit SLA, benannte Engineers",
          },
          {
            capability: "Onboarding",
            oss: "Doku und die Showcase",
            ent: "Begleiteter Pilot, Architektur-Review",
          },
          {
            capability: "Einfluss auf die Roadmap",
            oss: "Offene Issues und PRs",
            ent: "Direkt, an den Daten Ihrer Branche",
          },
          {
            capability: "Preis",
            oss: "Kostenlos, für immer",
            ent: "Sprechen Sie mit uns",
          },
        ],
      },
    ],
    workspaceNote:
      "Workspace-Isolierung lebt im Open-Source-Kern und ist immer an; ein Workspace hat eigenes Datenbank-Schema, eigene Beweise, eigenes KI-Memory und eigenen Endpunkt. Enterprise legt nicht die Mauer dazu; es legt die Autorisierung dazu, die entscheidet, wer welche Schublade öffnen darf.",
    workspaceCta: "So funktionieren Workspaces",
  },
  closing: {
    titleLead: "Gratis starten.",
    titleHighlight: "Später anrufen.",
    lede: "Fast alle starten mit dem Open-Source-Kern und bleiben dort. Das Gespräch lohnt, wenn SSO, Rollen und ein abgestimmtes Modell wichtiger werden als der Scan selbst.",
    ctaPrimary: "Den kostenlosen Kern holen",
    ctaSecondary: "Über Enterprise sprechen",
    ctaTertiary: "Oder erst in der Live-Showcase stöbern",
  },
};

export default de;
