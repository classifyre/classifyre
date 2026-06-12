import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Case",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
