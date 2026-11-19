import type { Metadata } from "next";

import { ogImage } from "@/lib/og-image";

import { EditionsPage } from "@/components/editions";

import "../../../landing.css";

/**
 * /de/open-source-vs-enterprise (German). Same shared `<EditionsPage>` as
 * the English route, only metadata and words differ.
 */

export const metadata: Metadata = {
  title: "Open Source vs. Enterprise: Gleiche Engine, anderer Raum",
  description:
    "Jede Classifyre-Funktion ist Open Source, auch SSO, Rollen, Maskierung und das Power-BI-Gateway. Enterprise sind Pilot, Umsetzung, SLA und Anpassung durch unsere Ingenieure.",
  alternates: {
    canonical: "/de/open-source-vs-enterprise/",
    languages: {
      en: "/open-source-vs-enterprise/",
      de: "/de/open-source-vs-enterprise/",
      "x-default": "/open-source-vs-enterprise/",
    },
  },
  openGraph: {
    title: "Classifyre: alles ist Open Source. Enterprise sind wir, in Ihrem Projekt.",
    description:
      "SSO, Rollen, Maskierung und das SQL-Gateway stehen unter Apache-2.0. Enterprise sind ein Pilot zum Festpreis, Umsetzung, ein SLA mit benannten Ingenieuren und Anpassung.",
    type: "website",
    images: [ogImage("de", "editions", "Classifyre: alles ist Open Source")],
  },
};

export default function GermanEditionsRoute() {
  return <EditionsPage locale="de" />;
}
