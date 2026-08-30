import type { Metadata } from "next";

import { MovedPage } from "@/components/moved-page";

export const metadata: Metadata = {
  title: "Moved to Connections & Duplicates",
  robots: { index: false, follow: true },
};

export default function ConnectionsMovedPage() {
  return (
    <MovedPage
      target="/how-it-works/duplicates-and-similarity/"
      title="Connections & Fingerprints has moved"
    >
      The same material, rewritten around duplicate review — shared values,
      semantic similarity, and what lineage adds on top of both.
    </MovedPage>
  );
}
