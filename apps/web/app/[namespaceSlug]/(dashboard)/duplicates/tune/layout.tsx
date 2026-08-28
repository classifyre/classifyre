import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tuning",
  description:
    "Weights, thresholds and index health for duplicate detection.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
