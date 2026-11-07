import type { Metadata } from "next";
import { PlatformAdmin } from "@/components/platform/platform-admin";
import { NO_INDEX } from "@/lib/seo-metadata";

export const metadata: Metadata = { title: "Platform", robots: NO_INDEX };

export default function PlatformPage() {
  return <PlatformAdmin />;
}
