import type { Metadata } from "next";

import { getLandingCopy } from "@/content/landing";
import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";
import { LandingPage } from "@/components/landing";

import "../../landing.css";

/**
 * Marketing landing page (German, `/de/…`).
 *
 * Identical composition to the English page: one `<LandingPage locale>`,
 * one shared copy module (`@/content/landing`), so the two locales only
 * differ in words, never in structure or behaviour.
 */

export const metadata: Metadata = {
  title:
    "Open-Source-Ermittlungsplattform: der Spur folgen, Fälle abschließen",
  description:
    "Classifyre liest die Systeme, die Sie bereits betreiben, findet die von Ihnen definierten Signale und verfolgt sie über Quellen hinweg: Lineage, gereihte Beweise, Fälle und ein KI-Autopilot. Open-Source-Ermittlungsplattform aus Europa. Läuft mit Docker oder Helm auf Kubernetes.",
  keywords: [
    "Ermittlungsplattform",
    "Open-Source-Ermittlungssoftware",
    "Datenerkennung Plattform",
    "Entity Resolution über Quellen",
    "Fallmanagement Ermittlungen",
    "KI-Ermittlungsautopilot",
    "selbst gehostete Datenermittlung",
  ],
  alternates: {
    canonical: "/de/",
    languages: {
      en: "/",
      de: "/de/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: "Classifyre: der Spur folgen. Den Fall schließen.",
    description:
      "Eine Open-Source-Ermittlungsplattform: Detektoren und Tags heben Beweise hervor, Lineage verbindet sie über Quellen hinweg, Fälle machen daraus eine Ermittlung, und ein KI-Autopilot arbeitet zwischen den Scans. Made in Austria, läuft auf Ihrem Rechner oder Ihrem Cluster.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre: der Spur folgen. Den Fall schließen.",
    description:
      "Open-Source-Datenermittlung: Signale, die Sie definieren, verfolgt über Quellen hinweg, als Fälle mit gereihten Beweisen und einem KI-Autopilot. Ein Docker-Image oder ein Helm-Chart.",
  },
};

export default function GermanHomePage() {
  const copy = getLandingCopy("de");
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
  );

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Classifyre",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes",
    url: `${siteUrl.replace(/\/$/, "")}/de/`,
    description:
      "Classifyre ist eine Open-Source-Ermittlungsplattform: Detektoren und Tags heben Beweise aus Quellsystemen hervor, Lineage verbindet sie über Systeme hinweg, Findings werden zu Anfragen, Duplikaten und Fällen, und der KI-Autopilot arbeitet die Ermittlung zwischen den Scans weiter. Verfügbar als freies All-in-One-Docker-Image für macOS, Windows und Linux sowie als Helm-Chart für Kubernetes.",
    offers: [
      {
        "@type": "Offer",
        name: "Classifyre All-in-One (Docker)",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Open-Source-Core auf Kubernetes (Helm)",
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
      <LandingPage locale="de" />
    </>
  );
}
