import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../landing.css";

export const metadata = topicMetadata("en", "unity-catalog-alternative");

export default function UnityCatalogAlternativePage() {
  return <TopicPage locale="en" id="unity-catalog-alternative" />;
}
