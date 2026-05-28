import { DashboardLayout } from "@/components/dashboard-layout";
import { isS3Configured } from "@/lib/server-config";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout s3Configured={isS3Configured()}>{children}</DashboardLayout>;
}
