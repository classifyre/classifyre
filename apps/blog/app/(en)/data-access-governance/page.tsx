import { TopicPage } from "@/components/topic/topic-page";
import { topicMetadata } from "@/lib/topic-metadata";

import "../../landing.css";

export const metadata = topicMetadata("en", "data-access-governance");

export default function DataAccessGovernancePage() {
  return <TopicPage locale="en" id="data-access-governance" />;
}
