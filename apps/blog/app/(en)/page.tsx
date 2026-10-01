import type { Metadata } from "next";

import { getLandingCopy } from "@/content/landing";
import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";
import { LandingPage } from "@/components/landing";

import "../landing.css";

/**
 * Marketing landing page (English).
 *
 * The Nextra chrome (header, footer) comes from `app/(en)/layout.tsx`; this
 * file owns the page's metadata, its structured data, and the shared
 * `<LandingPage>` composition. All copy lives in `@/content/landing`, shared
 * with the German page so the two locales cannot drift.
 */

export const metadata: Metadata = {
  title:
    "Open-Source Investigation Platform: Follow the Evidence, Close the Case",
  description:
    "Classifyre reads the systems you already run, finds the signals you define and follows them across sources: lineage, ranked evidence, cases and an AI autopilot. Open-source investigation platform, made in the EU. Run it with Docker or Helm on Kubernetes.",
  keywords: [
    "investigation platform",
    "open source investigation software",
    "data detection platform",
    "entity resolution across sources",
    "case management for investigations",
    "AI investigation autopilot",
    "self-hosted data investigation",
  ],
  alternates: {
    canonical: "/",
    languages: {
      en: "/",
      de: "/de/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: "Classifyre: Follow the evidence. Close the case.",
    description:
      "An open-source investigation platform: detectors and tags surface evidence, lineage connects it across sources, cases turn it into an investigation, and an AI autopilot works between scans. Made in Austria, runs on your machine or your cluster.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre: Follow the evidence. Close the case.",
    description:
      "Open-source data investigation: signals you define, followed across sources into cases with ranked evidence and an AI autopilot. One Docker image, or a Helm chart.",
  },
};

export default function HomePage() {
  const copy = getLandingCopy("en");
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
  );

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Classifyre",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes",
    url: siteUrl,
    description:
      "Classifyre is an open-source investigation platform: detectors and tags surface evidence across source systems, lineage connects it across them, findings become inquiries, duplicates and cases, and the AI autopilot works the investigation between scans. Available as a free all-in-one Docker image that runs on macOS, Windows and Linux, and as a Helm chart for Kubernetes.",
    offers: [
      {
        "@type": "Offer",
        name: "Classifyre All-in-One (Docker)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Open Source Core on Kubernetes (Helm)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Enterprise",
        priceSpecification: {
          "@type": "PriceSpecification",
          priceCurrency: "USD",
        },
      },
    ],
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: copy.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(softwareApplicationSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(faqSchema),
        }}
      />
      <LandingPage locale="en" />
    </>
  );
}
