import type { Metadata } from "next";

import { getLandingCopy } from "@/content/landing";
import { ogImage } from "@/lib/og-image";
import { routes } from "@/lib/site";
import { IncidentResponsePage } from "@/components/use-cases/incident-response";

import "../../../../landing.css";

const copy = getLandingCopy("de").incident;
const en = `${routes.incidentResponse}/`;
const de = `/de${routes.incidentResponse}/`;

export const metadata: Metadata = {
  title: { absolute: `${copy.metaTitle} | Classifyre` },
  description: copy.metaDescription,
  keywords: [
    "Vorfallbearbeitung",
    "Datenabfluss untersuchen",
    "Datenleck",
    "Secrets im Code",
    "Duplikaterkennung über Systeme",
  ],
  alternates: {
    canonical: de,
    languages: { en, de, "x-default": en },
  },
  openGraph: {
    title: copy.metaTitle,
    description: copy.metaDescription,
    type: "website",
    images: [ogImage("de", "incident-response", copy.metaTitle)],
    locale: "de_AT",
  },
  twitter: {
    card: "summary_large_image",
    title: copy.metaTitle,
    description: copy.metaDescription,
    images: [ogImage("de", "incident-response", copy.metaTitle).url],
  },
};

export default function GermanIncidentResponse() {
  return <IncidentResponsePage locale="de" />;
}
