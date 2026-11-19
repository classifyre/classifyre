import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../landing.css";

export const metadata = topicMetadata("en", "immuta-alternative");

export default function ImmutaAlternativePage() {
  return <TopicPage locale="en" id="immuta-alternative" />;
}
