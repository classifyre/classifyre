import type { Metadata } from "next";

import { MovedPage } from "@/components/moved-page";

export const metadata: Metadata = {
  title: "Moved to The case board",
  robots: { index: false, follow: true },
};

export default function CaseGraphMovedPage() {
  return (
    <MovedPage target="/investigations/cases/board/" title="The graph is now the case board">
      Every case now opens on its case board: evidence, findings, hypotheses and
      notes on one canvas, with the relations between them, suggested neighbours
      and Show connections.
    </MovedPage>
  );
}
