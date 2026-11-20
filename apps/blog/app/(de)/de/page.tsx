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
  "Classifyre setzt Ihr Berechtigungskonzept auf 40+ Systemen durch: Zugriff nach Rolle, Maskierung, Protokollierung. Open Source, im eigenen Rechenzentrum.";

const ogTitle = "Classifyre: Ihr Berechtigungskonzept, bei jeder Abfrage durchgesetzt.";
const ogDescription =
  "Ein kontrollierter Zugang zu allen Daten. Zugriff nach Organisationsstruktur, maskierte personenbezogene Daten, lückenlose Protokollierung, alles on-prem.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre: Datenzugriff steuern, Open Source, On-Premises",
  },
  description,
  keywords: [
    "Berechtigungskonzept",
    "Berechtigungskonzept umsetzen",
    "Datenzugriff steuern",
    "Zugriffssteuerung",
    "Rollen- und Rechtekonzept",
    "Need-to-know-Prinzip",
    "Data Governance Plattform Open Source",
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
