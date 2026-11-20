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
  "Control who sees which data across 40+ systems: access by department and role, masking by default, every read logged. Open source, on your own infrastructure — on-premises, your own cloud, or AWS, Azure or Google Cloud.";

const ogTitle = "Classifyre: Your access rules, enforced on every query.";
const ogDescription =
  "One governed way into all your data. Access follows your org structure, personal data stays masked, every read is logged, nothing leaves your servers.";

export const metadata: Metadata = {
  title: {
    absolute: "Classifyre: Open-Source Data Access Governance Platform",
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
