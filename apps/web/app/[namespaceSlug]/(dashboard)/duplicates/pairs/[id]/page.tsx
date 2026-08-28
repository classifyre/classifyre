"use client";

import * as React from "react";
import { useRouteId } from "@/lib/use-route-id";
import { DuplicatesShell } from "@/components/review/duplicates-shell";
import { PairLevel } from "@/components/review/pair-level";
import { decodePairId } from "@/components/review/review-format";

/** One pair, and the decision it is asking for. */
export default function PairPage() {
  const raw = useRouteId();
  const pair = React.useMemo(() => decodePairId(raw), [raw]);

  return (
    <DuplicatesShell active="queue" bare>
      {({ portfolio, refresh }) =>
        pair ? (
          <PairLevel
            aId={pair.aId}
            bId={pair.bId}
            hairball={portfolio.lineageHairball}
            onDecided={refresh}
          />
        ) : null
      }
    </DuplicatesShell>
  );
}
