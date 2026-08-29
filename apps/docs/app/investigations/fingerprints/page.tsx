import type { Metadata } from "next";

import { MovedPage } from "@/components/moved-page";

export const metadata: Metadata = {
  title: "Moved to Duplicate Review",
  robots: { index: false, follow: true },
};

export default function FingerprintsMovedPage() {
  return (
    <MovedPage target="/duplicates/" title="Fingerprints is now Duplicate Review">
      The similarity graph was replaced by a review queue: matches grouped by why
      they matched, ranked by how much work each decision settles, and worked
      pair by pair.
    </MovedPage>
  );
}
