import type { Metadata } from "next";

import { ogImage } from "@/lib/og-image";

import { getLandingCopy } from "@/content/landing";
import {
  JsonLdScripts,
  generateFaqSchema,
  generateSoftwareSchema,
  siteOrigin,
} from "@/lib/seo";
import { LandingPage } from "@/components/landing";

import "../../landing.css";

/**
 * Marketing landing page (German, `/de/…`). Same composition as the English
 * page; the two locales differ in words, never in structure or behaviour.
 */

const description =
  "Personenbezogene Daten in 40+ Systemen finden, automatisch maskieren und alles mit SQL und Power BI abfragen. DSGVO-konform, On-Premises, Open Source aus Österreich.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre: Open-Source-Data-Governance, On-Premises",
  },
  description,
  keywords: [
    "Data Governance",
    "Open Source Data Governance",
    "Datenklassifizierung",
    "Datenmaskierung",
    "dynamische Datenmaskierung",
    "personenbezogene Daten finden",
    "DSGVO-konform",
    "Datensouveränität",
    "On-Premises",
    "Pseudonymisierung",
    "Zugriffsprotokoll",
  ],
  alternates: {
    canonical: "/de/",
    languages: { en: "/", de: "/de/", "x-default": "/" },
  },
  openGraph: {
    title: "Classifyre: Finden. Schützen. Nutzen.",
    description:
      "Open-Source-Data-Governance: personenbezogene Daten finden, in der Abfrage maskieren und mit SQL, Excel und Power BI nutzen. Jeder Zugriff protokolliert. Nichts verlässt Ihre Server.",
    type: "website",
    images: [ogImage("de", "home", "Classifyre: Finden. Schützen. Nutzen.")],
    locale: "de_AT",
    alternateLocale: ["de_DE", "en_US"],
  },
  twitter: {
    card: "summary_large_image",
    images: [ogImage("de", "home", "Classifyre: Finden. Schützen. Nutzen.").url],
    title: "Classifyre: Finden. Schützen. Nutzen.",
    description,
  },
};

export default function GermanHomePage() {
  const copy = getLandingCopy("de");
  const siteUrl = siteOrigin();
  return (
    <>
      <JsonLdScripts
        schemas={[generateSoftwareSchema(siteUrl, "de"), generateFaqSchema(copy.faq.items)]}
      />
      <LandingPage locale="de" />
    </>
  );
}
