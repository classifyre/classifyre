import type { Metadata } from "next";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: "Case",
};

// Static export: emit a single placeholder shell for this dynamic segment
// (covers this route and its children, e.g. evidence/add); the page reads the
// real id from the URL at runtime (see @/lib/use-route-id).
export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
