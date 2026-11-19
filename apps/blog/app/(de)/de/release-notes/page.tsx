import type { Metadata } from "next";

import { ReleaseNotesPage } from "@/components/release-notes";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Release Notes",
  description:
    "Was sich in jedem Classifyre-Release geändert hat: neue Funktionen, Änderungen, Fehlerbehebungen und Sicherheitsupdates, direkt aus dem Changelog im Repository.",
  alternates: {
    canonical: "/de/release-notes/",
    languages: {
      en: "/release-notes/",
      de: "/de/release-notes/",
      "x-default": "/release-notes/",
    },
  },
  openGraph: {
    title: "Classifyre — Release Notes",
    description: "Was sich in jedem Classifyre-Release geändert hat.",
    type: "website",
  },
};

export default function ReleaseNotesDe() {
  return (
    <ReleaseNotesPage
      locale="de"
      copy={{
        eyebrow: "Changelog",
        titleLead: "Release",
        titleMark: "Notes",
        lede: "Jede für Nutzer sichtbare Änderung in jedem Classifyre-Release, neueste zuerst.",
        intro:
          "Diese Notes werden beim Release aus dem Changelog im Classifyre-Repository zusammengestellt. Was Sie hier lesen, ist das, was ausgeliefert wurde.",
        latest: "Neuestes Release",
        languageNote:
          "Die Einträge werden nur auf Englisch gepflegt und hier unverändert wiedergegeben.",
        githubReleases: "Alle Releases auf GitHub",
        types: {
          Added: "Neu",
          Changed: "Geändert",
          Deprecated: "Veraltet",
          Removed: "Entfernt",
          Fixed: "Behoben",
          Security: "Sicherheit",
        },
      }}
    />
  );
}
