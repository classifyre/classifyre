import type { Metadata } from "next";

import { ReleaseNotesPage } from "@/components/release-notes";
import { routes } from "@/lib/site";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Release notes",
  description:
    "What changed in each Classifyre release: new features, changes, fixes and security updates, straight from the changelog in the repository.",
  alternates: {
    canonical: routes.releaseNotes,
    languages: {
      en: "/release-notes/",
      de: "/de/release-notes/",
      "x-default": "/release-notes/",
    },
  },
  openGraph: {
    title: "Classifyre — Release notes",
    description: "What changed in each Classifyre release.",
    type: "website",
  },
};

export default function ReleaseNotes() {
  return (
    <ReleaseNotesPage
      locale="en"
      copy={{
        eyebrow: "Changelog",
        titleLead: "Release",
        titleMark: "notes",
        lede: "Every user-facing change in every Classifyre release, newest first.",
        intro:
          "These notes are compiled from the changelog in the Classifyre repository when a release is cut, so what you read here is what shipped.",
        latest: "Latest release",
        languageNote: "",
        githubReleases: "All releases on GitHub",
        types: {
          Added: "Added",
          Changed: "Changed",
          Deprecated: "Deprecated",
          Removed: "Removed",
          Fixed: "Fixed",
          Security: "Security",
        },
      }}
    />
  );
}
