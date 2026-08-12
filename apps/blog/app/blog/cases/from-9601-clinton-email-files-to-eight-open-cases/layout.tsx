import type { Metadata } from "next";
import type { ReactNode } from "react";

import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";

const title = "How AI Investigated 9,601 Hillary Clinton Emails";
const description =
  "See how Classifyre autonomously investigated 9,601 Hillary Clinton email files, tested 20 detectors, and opened eight evidence-backed cases.";
const path =
  "/blog/2026-08/from-9601-clinton-email-files-to-eight-open-cases";
const siteUrl = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
);
const articleUrl = `${siteUrl}${path}`;

export const metadata: Metadata = {
  alternates: {
    canonical: path,
  },
  keywords: [
    "Hillary Clinton emails",
    "Clinton email investigation",
    "AI investigation",
    "autonomous AI agents",
    "FOIA redaction codes",
    "data classification",
    "custom detectors",
    "Classifyre",
  ],
  openGraph: {
    type: "article",
    title,
    description,
    url: articleUrl,
    siteName: "Classifyre",
    publishedTime: "2026-08-11T00:00:00.000Z",
    modifiedTime: "2026-08-11T00:00:00.000Z",
    authors: ["Banandre"],
    section: "Field Notes",
    tags: [
      "AI investigation",
      "data classification",
      "custom detectors",
      "FOIA",
    ],
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "@id": `${articleUrl}#article`,
  headline: title,
  description,
  url: articleUrl,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": articleUrl,
  },
  datePublished: "2026-08-11T00:00:00.000Z",
  dateModified: "2026-08-11T00:00:00.000Z",
  articleSection: "Field Notes",
  inLanguage: "en-US",
  author: {
    "@type": "Person",
    name: "Banandre",
  },
  publisher: {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "Classifyre",
    url: siteUrl,
  },
  about: [
    "Autonomous AI investigation",
    "Hillary Clinton email corpus",
    "Data classification",
    "FOIA redaction analysis",
  ],
  mentions: [
    {
      "@type": "Dataset",
      name: "Hillary Clinton Emails - WikiLeaks",
      url: "https://huggingface.co/datasets/from-our-page/hillary-clinton-emails-wikileaks",
    },
    {
      "@type": "SoftwareApplication",
      name: "Classifyre",
      url: "https://demo.classifyre.com/hillary-clinton-emails-2",
      applicationCategory: "Data classification software",
    },
  ],
};

export default function InvestigationArticleLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(articleSchema),
        }}
      />
      {children}
    </>
  );
}
