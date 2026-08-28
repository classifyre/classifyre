import type { Metadata } from "next";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: "Pair",
  description: "Why two assets matched, and what to do about it.",
};

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
