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
        ? "Open Source: Classifyre setzt Ihr Berechtigungskonzept auf 40+ Systemen durch, mit Maskierung und Protokollierung jedes Zugriffs. On-Premises, aus Österreich."
        : "Open-source data access governance platform: access by department and role across 40+ systems, masking by default, every read logged. Deploy on-premises, in your own cloud, or on AWS, Azure or Google Cloud. Made in Austria.",
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
        ? "Classifyre entwickelt Open-Source-Software, mit der Organisationen den Datenzugriff steuern: Zugriff nach Rolle, Datenmaskierung und Protokollierung jedes Zugriffs, selbst betrieben. Gebaut in Österreich."
        : "Classifyre builds an open-source data access governance platform: one governed way into an organisation's data, with access by role, data masking and a log of every read. Deploy on-premises, in your own cloud, or on AWS, Azure or Google Cloud. Built in Austria.",
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
    applicationSubCategory: de ? "Datenzugriffssteuerung" : "Data access governance",
    operatingSystem: "Docker, Linux, macOS, Windows, Kubernetes",
    url: de ? `${siteUrl}/de/` : `${siteUrl}/`,
    inLanguage: de ? "de" : "en",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isAccessibleForFree: true,
    downloadUrl: "https://hub.docker.com/r/classifyre/all-in-one",
    codeRepository: "https://github.com/classifyre/classifyre",
    description: de
      ? "Classifyre setzt Ihr Berechtigungskonzept auf allen Datenquellen durch: Zugriff nach Abteilung, Rolle und Regel, personenbezogene Daten maskiert, jeder Zugriff protokolliert, im eigenen Rechenzentrum. Open Source unter Apache-2.0, über 40+ Systeme."
      : "Classifyre is the one governed way into your organisation's data: access follows your departments, roles and rules, personal data stays masked until someone is cleared for it, and every read is on record, on your own servers. Open source under Apache-2.0, across 40+ systems.",
    featureList: de
      ? [
          "Zugriff nach Organisation: AD-Gruppen aus Entra ID, Active Directory, Okta, OIDC und SAML",
          "Freigaben pro Gruppe, Quelle und Tabelle mit Ablaufdatum",
          "Zeilenfilter pro Gruppe und Zugriffsanfragen",
          "Dynamische Datenmaskierung: geschwärzt, letzte vier, gehasht, leer, ausgeblendet",
          "Datenklassifizierung personenbezogener Daten mit Score und Begründung",
          "Datenprodukte als geteilte Datasets über mehrere Quellen",
          "PostgreSQL-Endpunkt für Power BI, Excel und Tableau, KI-Agenten über MCP",
          "Protokollierung jedes Lesezugriffs",
          "SSO, Rollen, Mandanten und Workspaces, alles Open Source",
        ]
      : [
          "Access by organisation: groups from Entra ID, Active Directory, Okta, OIDC and SAML",
          "Grants per group, source and table, with end dates",
          "Row filters per group and access requests",
          "Dynamic data masking: redacted, last four, hashed, empty, hidden",
          "Classification of personal data with a score and a reason",
          "Data products as shared datasets across sources",
          "PostgreSQL endpoint for Power BI, Excel and Tableau; AI agents over MCP",
          "Audit log of every read",
          "SSO, roles, tenants and workspaces, all open source",
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
