import type { Metadata } from "next";

import { SourcesPage } from "@/components/sources";
import { sourceCount } from "@/components/source-showcase";

import "../../../landing.css";

const total = sourceCount();

export const metadata: Metadata = {
  title: "Unterstützte Quellen",
  description: `Jedes System, das Classifyre scannen kann: ${total} Konnektoren über Datenbanken, Warehouses und Lakehouses, Streaming, Object Storage, Kollaborationstools, Analytics und öffentliche Inhalte. Jeder Konnektor verlinkt auf seine Konfigurationsreferenz.`,
  alternates: {
    canonical: "/de/sources/",
    languages: {
      en: "/sources/",
      de: "/de/sources/",
      "x-default": "/sources/",
    },
  },
  openGraph: {
    title: "Classifyre: Unterstützte Quellen",
    description: `${total} Konnektoren über Datenbanken, Lakehouses, Storage, Kollaborationstools, Analytics und öffentliche Inhalte.`,
    type: "website",
  },
};

export default function SourcesPageDe() {
  return <SourcesPage locale="de" />;
}
