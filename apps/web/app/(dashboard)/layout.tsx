import { DashboardLayout } from "@/components/dashboard-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  // Read directly from env — injected by Helm from objectStorage.enabled.
  // This is a server component so the env var is always available at runtime.
  const s3Configured = process.env.S3_CONFIGURED === "true";
  return <DashboardLayout s3Configured={s3Configured}>{children}</DashboardLayout>;
}
