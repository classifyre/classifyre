import type { Metadata } from "next";
import { TenantAdmin } from "@/components/access/tenant-admin";
import { NO_INDEX } from "@/lib/seo-metadata";

export const metadata: Metadata = { title: "Tenant", robots: NO_INDEX };

export default function TenantPage() {
  return <TenantAdmin />;
}
