import type { Metadata } from "next";

import { getLandingCopy } from "@/content/landing";
import { ogImage } from "@/lib/og-image";
import { routes } from "@/lib/site";
import { IncidentResponsePage } from "@/components/use-cases/incident-response";

import "../../../landing.css";

const copy = getLandingCopy("en").incident;
const en = `${routes.incidentResponse}/`;
const de = `/de${routes.incidentResponse}/`;

export const metadata: Metadata = {
  title: { absolute: `${copy.metaTitle} | Classifyre` },
  description: copy.metaDescription,
  keywords: [
    "data leak incident response",
    "data breach investigation",
    "leaked secrets",
    "duplicate detection across systems",
    "case management for data leaks",
  ],
  alternates: {
    canonical: en,
    languages: { en, de, "x-default": en },
  },
  openGraph: {
    title: copy.metaTitle,
    description: copy.metaDescription,
    type: "website",
    images: [ogImage("en", "incident-response", copy.metaTitle)],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: copy.metaTitle,
    description: copy.metaDescription,
    images: [ogImage("en", "incident-response", copy.metaTitle).url],
  },
};

export default function IncidentResponse() {
  return <IncidentResponsePage locale="en" />;
}
