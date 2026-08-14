import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";

type ArticleMention = {
  "@type": string;
  name: string;
  url?: string;
  [key: string]: unknown;
};

type ArticleJsonLdProps = {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  articleSection?: string;
  about?: string[];
  mentions?: ArticleMention[];
  liveCaseUrl?: string;
  liveCaseName?: string;
};

export function ArticleJsonLd({
  headline,
  description,
  path,
  datePublished,
  dateModified,
  authorName,
  articleSection,
  about,
  mentions,
  liveCaseUrl,
  liveCaseName,
}: ArticleJsonLdProps) {
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://www.classifyre.com",
  );
  const articleUrl = `${siteUrl}${path}`;

  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${articleUrl}#article`,
    headline,
    description,
    url: articleUrl,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": articleUrl,
    },
    datePublished,
    dateModified: dateModified ?? datePublished,
    ...(articleSection ? { articleSection } : {}),
    inLanguage: "en-US",
    author: {
      "@type": "Person",
      name: authorName,
    },
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "Classifyre",
      url: siteUrl,
    },
    ...(about ? { about } : {}),
    ...(mentions ? { mentions } : {}),
    ...(liveCaseUrl
      ? {
          potentialAction: {
            "@type": "ViewAction",
            name: liveCaseName ? `Open the ${liveCaseName} case file` : "Open live case",
            target: [liveCaseUrl],
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(schema) }}
    />
  );
}
