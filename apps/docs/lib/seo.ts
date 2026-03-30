type SiteLikeSchema = {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
};

export function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }

  return basePath.startsWith("/")
    ? basePath.replace(/\/$/, "")
    : `/${basePath.replace(/\/$/, "")}`;
}

export function resolveDocsBasePath(): string {
  const configured =
    process.env.NEXT_PUBLIC_DOCS_BASE_PATH ??
    (process.env.NODE_ENV === "production" ? "/docs" : "");
  return normalizeBasePath(configured);
}

export function buildDocsSiteUrl(
  siteOrigin: string,
  docsBasePath = resolveDocsBasePath(),
): string {
  return `${siteOrigin.replace(/\/$/, "")}${docsBasePath}`;
}

export function generateDocsSiteSchema(docsSiteUrl: string): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${docsSiteUrl}/#website`,
    name: "Classifyre Docs",
    description:
      "Documentation for the Classifyre platform: architecture notes, deployment patterns, and practical implementation guides.",
    url: docsSiteUrl,
    inLanguage: "en-US",
  };
}

export function generateDocsCollectionSchema(
  docsSiteUrl: string,
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${docsSiteUrl}/#collection`,
    name: "Classifyre Documentation",
    description:
      "Technical documentation pages for setup, deployment, and SEO/sitemap configuration.",
    url: docsSiteUrl,
    isPartOf: {
      "@type": "WebSite",
      "@id": `${docsSiteUrl}/#website`,
    },
  };
}
