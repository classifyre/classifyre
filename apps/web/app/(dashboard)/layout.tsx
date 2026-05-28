import { DashboardLayout } from "@/components/dashboard-layout";
import { getServerConfig } from "@/lib/server-config";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout serverConfig={getServerConfig()}>{children}</DashboardLayout>;
}
