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
  "Open-Source Data Governance für Ihre bestehenden Systeme: sensible Daten erkennen, Zeilen- und Spaltenmaskierung nach Gruppen durchsetzen, Datenprodukte teilen und SQL, Power BI sowie Excel lückenlos protokollieren.";

const ogTitle = "Classifyre: Klare Datenregeln. Durchgesetzt bei jeder Abfrage.";
const ogDescription =
  "Durchgängige Open-Source Data Governance über 40+ Systeme: Zeilen- und Spaltenmaskierung nach Gruppen, verwaltete Datenprodukte, SQL-, Power-BI- und Excel-Zugriff auf eigener Infrastruktur.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre — Open-Source Data Governance Plattform",
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
