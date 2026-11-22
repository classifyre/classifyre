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
        ? "Open-Source Data Governance für Ihre bestehenden Systeme. Sensible Daten klassifizieren, Zeilen- und Spaltenmaskierung nach Gruppen durchsetzen, Datenprodukte teilen und SQL, Power BI sowie Excel protokollieren."
        : "Open-source data governance platform for the systems you already run. Classify sensitive data, enforce row and column masking by group, publish governed data products, and serve SQL, Power BI, and Excel with full audit logging.",
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
        ? "Classifyre entwickelt eine Open-Source Data-Governance-Plattform unter Apache-2.0. Entwickelt in Österreich nach europäischen Datenschutz- und Sicherheitsstandards, im Einsatz in Europa, Nordamerika und weltweit."
        : "Classifyre develops an open-source data governance platform under Apache-2.0. Built in Austria to European privacy and security standards, deployed by organisations across Europe, North America, and worldwide.",
    // Where the project is built. Search and AI answer engines read this to
    // answer "who makes it / where are they", which the About page says in
    // prose — the two must not drift apart.
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
    areaServed: ["EU", "US", "Worldwide"],
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

/**
 * The product, as structured data: free, Apache-2.0, running on the reader's
 * own infrastructure. The description and feature list tell the same story as
 * the page, in the same order: access by organisation first, then masking,
 * data products, tools, the read log; discovery is the first step of
 * masking, not the lead.
 */
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
    applicationCategory: "BusinessApplication",
    applicationSubCategory: de ? "Open-Source Data Governance" : "Open-source data governance",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes, OpenShift",
    url: de ? `${siteUrl}/de/` : `${siteUrl}/`,
    inLanguage: de ? "de" : "en",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isAccessibleForFree: true,
    downloadUrl: "https://hub.docker.com/r/classifyre/all-in-one",
    codeRepository: "https://github.com/classifyre/classifyre",
    description: de
      ? "Durchgängige Open-Source Data Governance für Ihre bestehenden Systeme: Quellen verbinden, sensible und fachspezifische Daten erkennen, Zeilen- und Spaltenmaskierung nach Gruppen durchsetzen, Datenprodukte anfordern und teilen sowie SQL, Power BI und Excel lückenlos protokollieren."
      : "End-to-end open-source data governance for the systems you already run: connect sources, classify sensitive and business-specific data, enforce row and column masking by group, request and publish governed data products, and serve SQL, Power BI, Excel, and ODBC with full audit logging.",
    featureList: de
      ? [
          "Integration mit bestehenden Systemen (40+ Datenbanken, Iceberg, Delta, Parquet, Cloud-Speicher) und bestehendem IAM (Entra ID, Active Directory, Okta, OIDC/SAML)",
          "Flexible Detektoren: PII, Secrets und eigene Geschäftsregeln von Regex bis zu lokalen KI-Modellen und LLMs",
          "Gruppenbasierte Zugriffssteuerung mit zeitlich begrenzten Freigaben und Zeilenfiltern",
          "Mehrstufige Datenmaskierung (geschwärzt, letzte vier, gehasht, leer, ausgeblendet) auf Tabellen und geteilten Datenprodukten",
          "Direkter SQL-, Power-BI-, Excel-, Tableau- und ODBC-Zugriff über persönliche Verbindungen",
          "Self-Service-Datenanfragen und verwaltete Datenprodukte (inkl. Delta-Freigabe) mit vererbten Masken",
          "Lückenlose Protokollierung jedes Lesezugriffs, Datenqualität und offene Datenverträge",
          "100 % Open Source unter Apache-2.0 für Docker, Kubernetes und OpenShift",
        ]
      : [
          "Integrates with existing systems (40+ databases, Iceberg, Delta, Parquet, cloud storage) and existing IAM (Entra ID, Active Directory, Okta, OIDC/SAML)",
          "Flexible detection: built-in PII and secret packs plus custom business detectors from regex to local AI models and LLMs",
          "Group-based access control with time-limited grants and row-level filtering",
          "Multi-level column and row masking (redacted, last four, hashed pseudonymisation, empty, hidden) on source tables and shared datasets",
          "Governed SQL, Power BI, Excel, Tableau, and ODBC access over personal expiring connections",
          "Plain-language dataset requests and governed Delta / live shared data products with inherited masking",
          "Complete audit trail of every read, scheduled data quality checks, and open data contracts",
          "100% open source under Apache-2.0 for Docker, Kubernetes, and OpenShift",
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
