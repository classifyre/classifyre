import type { Locale } from "@/lib/locale";
import topicSlugs from "@/lib/topic-slugs.json";

import { deChrome, deTopics } from "./de";
import { enChrome, enTopics } from "./en";
import type { TopicChrome, TopicCopy, TopicId } from "./types";

export type { DemoId, TopicChrome, TopicCopy, TopicId } from "./types";

export const TOPIC_IDS = topicSlugs.map((entry) => entry.id) as TopicId[];

export function getTopic(locale: Locale, id: TopicId): TopicCopy {
  return (locale === "de" ? deTopics : enTopics)[id];
}

export function getTopicChrome(locale: Locale): TopicChrome {
  return locale === "de" ? deChrome : enChrome;
}

/** The page's path in a locale, with the trailing slash the export uses. */
export function topicPath(locale: Locale, id: TopicId): string {
  const entry = topicSlugs.find((slug) => slug.id === id);
  if (!entry) throw new Error(`Unknown topic ${id}`);
  return locale === "de" ? `/de/${entry.de}/` : `/${entry.en}/`;
}

/** Footer and menu links to every topic page in a locale. */
export function topicLinks(locale: Locale): { label: string; href: string }[] {
  return TOPIC_IDS.map((id) => ({
    label: getTopic(locale, id).name,
    href: topicPath(locale, id),
  }));
}
