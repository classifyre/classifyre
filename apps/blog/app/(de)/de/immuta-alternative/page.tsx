import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../../landing.css";

export const metadata = topicMetadata("de", "immuta-alternative");

export default function ImmutaAlternativeDePage() {
  return <TopicPage locale="de" id="immuta-alternative" />;
}
