type SiteLikeSchema = {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
};

export function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/$/, "");
}

export function generateBlogSiteSchema(siteUrl: string): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: "Classifyre Engineering Blog",
    description:
      "Notes on architecture, delivery systems, and technical decision making in production engineering environments.",
    url: siteUrl,
    inLanguage: "en-US",
  };
}

export function generateOrganizationSchema(siteUrl: string): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "Classifyre",
    url: siteUrl,
    description: "Engineering platform and delivery system documentation.",
  };
}

export function generateBlogSchema(siteUrl: string): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${siteUrl}/#blog`,
    name: "Classifyre Engineering Blog",
    description:
      "Long-form engineering writing: architecture analysis, workflow design, and delivery tradeoffs.",
    url: siteUrl,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
    },
  };
}
