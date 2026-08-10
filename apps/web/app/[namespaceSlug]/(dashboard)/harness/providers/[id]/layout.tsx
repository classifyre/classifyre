import { dynamicIdParams } from "@/lib/dynamic-route";

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
