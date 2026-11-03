import { normalizeSiteUrl, safeJsonLdStringify } from "@/lib/seo";

type ArticleMention = {
  "@type": string;
  name: string;
  url?: string;
  [key: string]: unknown;
};

// The film embedded in the post, described so search can show it as a video.
type ArticleVideo = {
  name: string;
  description: string;
  youtubeId: string;
  uploadDate: string;
  // ISO 8601, e.g. "PT8M12S".
  duration: string;
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
  image?: string;
  video?: ArticleVideo;
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
  image,
  video,
}: ArticleJsonLdProps) {
  const siteUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://www.classifyre.com",
  );
  const articleUrl = `${siteUrl}${path}`;
  const inLanguage = path.startsWith("/de/") ? "de-DE" : "en-US";

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
    inLanguage,
    ...(image ? { image: `${siteUrl}${image}` } : {}),
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
    ...(video
      ? {
          video: {
            "@type": "VideoObject",
            name: video.name,
            description: video.description,
            thumbnailUrl: [
              `https://i.ytimg.com/vi/${video.youtubeId}/maxresdefault.jpg`,
            ],
            uploadDate: video.uploadDate,
            duration: video.duration,
            embedUrl: `https://www.youtube.com/embed/${video.youtubeId}`,
            url: `https://www.youtube.com/watch?v=${video.youtubeId}`,
            inLanguage: "en",
          },
        }
      : {}),
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
