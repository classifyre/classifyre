import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Decisions",
  description:
    "Duplicate decisions already taken, and whether they were used in a case or an inquiry.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
