import { getServerConfig } from "@/lib/server-config";
import RunnerDetailPageClient from "./runner-detail-page-client";

export default function Page() {
  const { s3Configured } = getServerConfig();
  return <RunnerDetailPageClient s3Configured={s3Configured} />;
}
