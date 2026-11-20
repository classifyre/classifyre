import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../../landing.css";

export const metadata = topicMetadata("de", "data-access-governance");

export default function BerechtigungskonzeptPage() {
  return <TopicPage locale="de" id="data-access-governance" />;
}
