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

import "../landing.css";

/**
 * Marketing landing page (English).
 *
 * The Nextra chrome (header, footer) comes from `app/(en)/layout.tsx`; this
 * file owns the page's metadata, its structured data, and the shared
 * `<LandingPage>` composition. All copy lives in `@/content/landing`.
 */

const description =
  "Self-hosted open-source data governance across your existing databases, lakehouses, and files: classify sensitive data in place, enforce live masking across SQL, Power BI, Excel, and AI agents, monitor quality and usage, publish data products, and resolve leaks.";

const ogTitle = "Classifyre: Find it. Govern it. Use it safely.";
const ogDescription =
  "Open-source data governance across your existing databases, lakehouses, and identity directory: in-place discovery, live masking for SQL, Power BI, Excel & AI agents, data quality, usage tracking, governed data products, and leak cases.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre — Open-Source Data Governance Platform",
  },
  description,
  keywords: [
    "data access governance",
    "governed data access",
    "open source data governance",
    "self-hosted data governance",
    "role-based access control",
    "attribute-based access control",
    "row-level security",
    "dynamic data masking",
    "pseudonymisation",
    "data products",
    "GDPR data access",
    "Power BI governed access",
  ],
  alternates: {
    canonical: "/",
    languages: { en: "/", de: "/de/", "x-default": "/" },
  },
  openGraph: {
    title: ogTitle,
    description: ogDescription,
    type: "website",
    images: [ogImage("en", "home", ogTitle)],
    locale: "en_US",
    alternateLocale: ["de_AT", "de_DE"],
  },
  twitter: {
    card: "summary_large_image",
    images: [ogImage("en", "home", ogTitle).url],
    title: ogTitle,
    description: ogDescription,
  },
};

export default function HomePage() {
  const copy = getLandingCopy("en");
  const siteUrl = siteOrigin();
  return (
    <>
      <JsonLdScripts
        schemas={[generateSoftwareSchema(siteUrl, "en"), generateFaqSchema(copy.faq.items)]}
      />
      <LandingPage locale="en" />
    </>
  );
}
