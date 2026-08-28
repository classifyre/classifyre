import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s · Duplicate review",
    default: "Duplicate review",
  },
  description:
    "Assets that look like the same thing, grouped by why they matched.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
