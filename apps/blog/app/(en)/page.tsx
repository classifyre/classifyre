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
  "Open-source data governance for the systems you already run: classify sensitive data, enforce row and column masking by group, publish governed data products, and query via SQL, Power BI, and Excel with every read logged.";

const ogTitle = "Classifyre: Control who sees what. Enforced on every query.";
const ogDescription =
  "End-to-end open-source data governance across 40+ systems. Row and column masking by group, governed data products, live SQL/Power BI/Excel access, and full audit logging on your own infrastructure.";

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
