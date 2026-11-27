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
  "Souveräne Data-Governance-Plattform für Ihre bestehenden Datenbanken, Lakehouses und Dateien: sensible Daten erkennen, Live-Maskierung für SQL, Power BI, Excel und KI-Agenten durchsetzen, Datenqualität und Nutzung überwachen und Datenabflüsse klären.";

const ogTitle = "Classifyre – Souveräne Data-Governance-Plattform";
const ogDescription =
  "Souveräne Data-Governance-Plattform für Ihre bestehenden Datenbanken, Lakehouses und Verzeichnisdienste: Erkennung, Live-Maskierung für SQL, Power BI, Excel & KI-Agenten, Datenqualität, Nutzungsanalyse, Datenprodukte und Fallbearbeitung.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre – Souveräne Data-Governance-Plattform",
  },
  description,
  keywords: [
    "Souveräne Data-Governance-Plattform",
    "Souveräne Data Governance",
    "Berechtigungskonzept",
    "Berechtigungskonzept umsetzen",
    "Datenzugriff steuern",
    "Zugriffssteuerung",
    "Rollen- und Rechtekonzept",
    "Need-to-know-Prinzip",
    "Data-Governance-Plattform",
    "Datenmaskierung",
    "Pseudonymisierung",
    "Zeilenfilter",
    "Protokollierung",
    "Datensouveränität",
    "On-Premises",
    "DSGVO",
  ],
  alternates: {
    canonical: "/de/",
    languages: { en: "/", de: "/de/", "x-default": "/" },
  },
  openGraph: {
    title: ogTitle,
    description: ogDescription,
    type: "website",
    images: [ogImage("de", "home", ogTitle)],
    locale: "de_AT",
    alternateLocale: ["de_DE", "en_US"],
  },
  twitter: {
    card: "summary_large_image",
    images: [ogImage("de", "home", ogTitle).url],
    title: ogTitle,
    description: ogDescription,
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
