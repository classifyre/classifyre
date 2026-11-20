import type { SourcesCopy } from "./sources";

import { docs } from "@/lib/site";

/**
 * German /sources copy: a full translation of `en` in `./sources.ts`,
 * type-checked against `SourcesCopy` so a missing string fails the build.
 * Links reuse the same shared URL constants as the English copy.
 */

const de: SourcesCopy = {
  hero: {
    mark: "Quellen",
    titleA: "Steuern Sie die Systeme,",
    titleBLead: "die Sie",
    titleBHighlight: "schon betreiben.",
    lede: {
      count: "Konnektoren",
      tail: "über Datenbanken, Warehouses und Lakehouses, Streaming, Object Storage, Kollaborationstools, Analytics und öffentliche Inhalte, alle direkt an der Quelle gelesen. Jede wird nach personenbezogenen Daten und Secrets klassifiziert; Tabellen in PostgreSQL, MySQL, Databricks, ODBC-Quellen, Delta, Iceberg und Dateien in Buckets stehen zudem für SQL, Excel und Power BI bereit, mit denselben Freigaben, Zeilenfiltern und Masken.",
    },
    micro: "{count} Konnektoren · direkt aus dem Schema",
    ctaCatalog: "Katalog durchstöbern",
    ctaGet: "Betreiben und einen anbinden",
  },
  catalog: {
    marker: "Voller Katalog",
    title: "Alle {count} Konnektoren",
    lede: "Suchen Sie nach Name, Kategorie oder Fähigkeit. Jeder Eintrag verlinkt auf seine Konfigurationsreferenz in der Doku-Site: Pflichtfelder, Auth und ein durchgearbeitetes Beispiel.",
    action: "Konfigurationsreferenz",
  },
  categories: {
    marker: "Nach Kategorie",
    title: "Wo Ihre Daten liegen",
    lede: "Konnektoren sind gruppiert nach dem, was sie sind, nicht nach Hersteller. Zählungen kommen direkt aus dem Schema, diese Seite kann also nie von dem abweichen, was das Produkt wirklich unterstützt.",
    label: "Kategorie",
    shortLabel: "Konnektoren",
  },
  capabilities: {
    marker: "Jeder Konnektor",
    title: "Was alle gemeinsam haben",
    lede: "Das System am anderen Ende wechselt. Was Classifyre mit dem Gelesenen tut, nicht.",
    items: [
      {
        title: "Assets, nicht nur Zeilen",
        body: "Jeder Konnektor liefert Assets mit dranhängenden Quell-Metadaten (Owner, Pfad, Zeitstempel), damit ein Befund immer mitführt, woher er kam.",
        href: docs.sources,
        hrefLabel: "Assets & Metadaten",
      },
      {
        title: "Vor dem Scan testen",
        body: "Jede Quelle lässt sich aus der App dry-runnen: Credentials prüfen, sehen, was sie lesen würde, und erst dann einen vollen Scan committen.",
        href: docs.sourceTesting,
        hrefLabel: "Quellen testen",
      },
      {
        title: "Sampling, das Kosten deckelt",
        body: "Große Tabellen und Dateien werden durch Sampling-Fenster mit Cursor pro Asset gelesen; ein Scan liest also einen begrenzten Ausschnitt statt allem.",
        href: docs.sampling,
        hrefLabel: "Sampling",
      },
      {
        title: "Ein Regelwerk für den Zugriff",
        body: "Freigaben pro Gruppe, Zeilenfilter, Masken und das Zugriffsprotokoll funktionieren gleich, egal aus welchem System eine Tabelle kommt. Das Berechtigungskonzept wird einmal umgesetzt, nicht pro Datenbank.",
        href: docs.whoMayQuery,
        hrefLabel: "Wer was abfragen darf",
      },
    ],
  },
  closing: {
    titleLead: "Fehlt der eine,",
    titleHighlight: "den Sie brauchen?",
    body: "Konnektoren sind Plugins, und das Projekt ist Open Source, die Antwort ist also entweder ein Pull Request oder ein Gespräch. Wenn Sie einen Konnektor für die Systeme Ihrer Branche brauchen oder Hilfe bei Einrichtung und Anpassung, kontaktieren Sie uns.",
    ctaPrimary: "Konnektor anfragen",
    ctaSecondary: "Hilfe anfragen",
  },
  mascots: {
    hiddenGem:
      "Der Classifyre-Ermittler hält eine Lupe über einen verborgenen Fund",
  },
};

export default de;
