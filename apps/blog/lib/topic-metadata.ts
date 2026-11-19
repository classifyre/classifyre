import type { Metadata } from "next";

import { getTopic, topicPath, type TopicId } from "@/content/topics";
import type { Locale } from "@/lib/locale";
import { ogImage } from "@/lib/og-image";

/** Page metadata for a topic page: title, description, hreflang pair. */
export function topicMetadata(locale: Locale, id: TopicId): Metadata {
  const topic = getTopic(locale, id);
  const en = topicPath("en", id);
  const de = topicPath("de", id);
  return {
    title: { absolute: `${topic.metaTitle} | Classifyre` },
    description: topic.metaDescription,
    keywords: [...topic.keywords],
    alternates: {
      canonical: locale === "de" ? de : en,
      languages: { en, de, "x-default": en },
    },
    openGraph: {
      title: topic.metaTitle,
      description: topic.metaDescription,
      type: "website",
      locale: locale === "de" ? "de_AT" : "en_US",
      images: [ogImage(locale, id, topic.metaTitle)],
    },
    twitter: {
      card: "summary_large_image",
      title: topic.metaTitle,
      description: topic.metaDescription,
      images: [ogImage(locale, id, topic.metaTitle).url],
    },
  };
}
