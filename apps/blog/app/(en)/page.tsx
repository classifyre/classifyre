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
  "Find personal data and secrets across 40+ systems, mask it automatically, and query everything with SQL and Power BI. Apache-2.0, self-hosted, made in Austria.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre: Open-Source Data Governance, Self-Hosted",
  },
  description,
  keywords: [
    "data governance",
    "open source data governance",
    "data access governance",
    "PII discovery",
    "data masking",
    "dynamic data masking",
    "data classification",
    "federated SQL",
    "self-hosted data governance",
    "GDPR compliant data access",
    "Power BI gateway",
  ],
  alternates: {
    canonical: "/",
    languages: { en: "/", de: "/de/", "x-default": "/" },
  },
  openGraph: {
    title: "Classifyre: Find it. Protect it. Use it.",
    description:
      "Open-source data governance: find personal data, mask it inside the query, and let people use SQL, Excel and Power BI. Every read is logged. Nothing leaves your servers.",
    type: "website",
    images: [ogImage("en", "home", "Classifyre: Find it. Protect it. Use it.")],
    locale: "en_US",
    alternateLocale: ["de_AT", "de_DE"],
  },
  twitter: {
    card: "summary_large_image",
    images: [ogImage("en", "home", "Classifyre: Find it. Protect it. Use it.").url],
    title: "Classifyre: Find it. Protect it. Use it.",
    description,
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
