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

export function generateBlogSiteSchema(
  siteUrl: string,
  locale: "en" | "de" = "en",
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: "Classifyre",
    description:
      locale === "de"
        ? "Open-Source-Data-Governance: personenbezogene Daten finden, automatisch maskieren und sicher mit SQL, Excel und Power BI abfragen. Selbst betrieben, made in Austria."
        : "Open-source data governance: find personal data, mask it automatically, and query everything safely with SQL, Excel and Power BI. Self-hosted, made in Austria.",
    url: siteUrl,
    inLanguage: locale === "de" ? "de-DE" : "en-US",
  };
}

export function generateOrganizationSchema(
  siteUrl: string,
  locale: "en" | "de" = "en",
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "Classifyre",
    url: siteUrl,
    description:
      locale === "de"
        ? "Classifyre entwickelt Open-Source-Data-Governance: Datenklassifizierung, Datenmaskierung und sicheren Datenzugriff, selbst betrieben. Gebaut in Österreich."
        : "Classifyre builds open-source data governance: data classification, data masking and safe data access, self-hosted. Built in Austria.",
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

export function generateBlogSchema(
  siteUrl: string,
  locale: "en" | "de" = "en",
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${siteUrl}/#blog`,
    name: "Classifyre Journal",
    description:
      locale === "de"
        ? "Produkt-Updates, Engineering-Notizen, Deployment-Anleitungen und Detektor-Designs von Classifyre."
        : "Product updates, engineering notes, deployment guidance, and detector design write-ups from Classifyre.",
    url: siteUrl,
    inLanguage: locale === "de" ? "de-DE" : "en-US",
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
    },
  };
}

/** The product, as structured data: free, Apache-2.0, self-hosted. */
export function generateSoftwareSchema(
  siteUrl: string,
  locale: "en" | "de" = "en",
): SiteLikeSchema {
  const de = locale === "de";
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#software`,
    name: "Classifyre",
    applicationCategory: "SecurityApplication",
    applicationSubCategory: de ? "Data Governance" : "Data governance",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes, OpenShift",
    url: de ? `${siteUrl}/de/` : `${siteUrl}/`,
    inLanguage: de ? "de" : "en",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isAccessibleForFree: true,
    downloadUrl: "https://hub.docker.com/r/classifyre/all-in-one",
    codeRepository: "https://github.com/classifyre/classifyre",
    description: de
      ? "Classifyre ist Open-Source-Data-Governance zum Selbstbetrieb: Es findet personenbezogene Daten und Secrets in über 40 Systemen, maskiert sie automatisch in der Abfrage und lässt Teams alles mit SQL, Excel und Power BI abfragen. Jeder Lesezugriff wird protokolliert."
      : "Classifyre is self-hosted, open-source data governance: it finds personal data and secrets across 40+ systems, masks them automatically inside the query, and lets teams query everything with SQL, Excel and Power BI. Every read is logged.",
    featureList: de
      ? [
          "Erkennung personenbezogener Daten (PII) und Secrets",
          "Datenklassifizierung mit Score und Begründung",
          "Dynamische Datenmaskierung: geschwärzt, letzte vier, gehasht, leer, ausgeblendet",
          "Freigaben pro Gruppe, Quelle und Tabelle mit Ablaufdatum",
          "Zeilenfilter und Zugriffsanfragen",
          "Föderierte SQL-Abfragen über Datenbanken, Delta, Iceberg und Parquet",
          "PostgreSQL-Endpunkt für Power BI, Excel und Tableau",
          "Protokoll jedes Lesezugriffs",
          "SSO, Rollen, Mandanten und Workspaces",
        ]
      : [
          "PII and secret discovery",
          "Data classification with a score and a reason",
          "Dynamic data masking: redacted, last four, hashed, empty, hidden",
          "Grants per group, source and table, with end dates",
          "Row filters and access requests",
          "Federated SQL across databases, Delta, Iceberg and Parquet",
          "PostgreSQL endpoint for Power BI, Excel and Tableau",
          "Audit log of every read",
          "SSO, roles, tenants and workspaces",
        ],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
    },
    publisher: { "@type": "Organization", "@id": `${siteUrl}/#organization` },
  };
}

/** FAQPage structured data from a list of questions and answers. */
export function generateFaqSchema(
  items: readonly { q: string; a: string }[],
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** BreadcrumbList for a page one level below a locale's home. */
export function generateBreadcrumbSchema(
  siteUrl: string,
  trail: readonly { name: string; path: string }[],
): SiteLikeSchema {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${siteUrl}${crumb.path}`,
    })),
  };
}

/** The site's public origin, from the build environment. */
export function siteOrigin(): string {
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
  );
}

/** One `<script type="application/ld+json">` payload per schema. */
export function JsonLdScripts({ schemas }: { schemas: readonly unknown[] }) {
  return schemas.map((schema, index) => (
    <script
      key={index}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(schema) }}
    />
  ));
}
