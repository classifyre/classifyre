import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../../landing.css";

export const metadata = topicMetadata("de", "unity-catalog-alternative");

export default function UnityCatalogAlternativeDePage() {
  return <TopicPage locale="de" id="unity-catalog-alternative" />;
}
