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
    name: "Classifyre",
    description:
      "Detect, classify, and label data across databases, lakehouses, collaboration tools, analytics systems, and public content.",
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
    description:
      "Open-source data detection, classification, and labeling platform for modern source systems, built in Austria.",
    // Where the project is built. Search and AI answer engines read this to
    // answer "who makes it / where are they", which the /made-in-europe page
    // says in prose — the two must not drift apart.
    foundingLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: "AT",
      },
    },
    address: {
      "@type": "PostalAddress",
      addressCountry: "AT",
    },
    areaServed: "EU",
    sameAs: ["https://github.com/classifyre/classifyre"],
  };
}

export function generateBlogSchema(siteUrl: string): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${siteUrl}/#blog`,
    name: "Classifyre Journal",
    description:
      "Product updates, engineering notes, deployment guidance, and detector design write-ups from Classifyre.",
    url: siteUrl,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
    },
  };
}
