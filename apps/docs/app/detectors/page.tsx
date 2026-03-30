import type { Metadata } from "next";

import { Badge } from "@workspace/ui/components";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";

import { NextraPageShell } from "@/components/nextra-page-shell";
import { buildDetectorsOverviewCopy } from "@/lib/detector-copy";

export const metadata: Metadata = {
  title: "Detectors",
  description:
    "Schema-driven detector documentation generated from all_detectors.json and all_detectors_examples.json.",
};

const LIFECYCLE_ORDER = ["active", "experimental", "planned", "deprecated"];

export default function DetectorsPage() {
  const detectors = getAllDetectorDocs();
  const totalExamples = detectors.reduce(
    (sum, d) => sum + d.examples.length,
    0,
  );
  const sourceCode = buildDetectorsOverviewCopy(detectors);

  const tocItems = [
    { id: "detectors-overview", value: "Overview" },
    { id: "active-detectors", value: "Active" },
    { id: "planned-detectors", value: "Planned" },
  ];

  const active = detectors.filter(
    (d) => d.catalogMeta.lifecycleStatus === "active",
  );
  const nonActive = detectors.filter(
    (d) => d.catalogMeta.lifecycleStatus !== "active",
  );

  return (
    <NextraPageShell
      title="Detectors"
      filePath="app/detectors/page.tsx"
      toc={tocItems}
      sourceCode={sourceCode}
    >
      <div className="space-y-8">
        <header id="detectors-overview" className="scroll-mt-24 space-y-4">
          <Badge
            variant="secondary"
            className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
          >
            Detectors
          </Badge>
          <h1 className="font-serif text-4xl font-black uppercase tracking-[0.08em] text-foreground sm:text-5xl">
            Detector Reference
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Every detector page is generated directly from{" "}
            <code className="font-mono text-xs">all_detectors.json</code> and{" "}
            <code className="font-mono text-xs">
              all_detectors_examples.json
            </code>
            . Update those files and the docs reflect the change automatically.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{detectors.length} detector types</Badge>
            <Badge variant="outline">{active.length} active</Badge>
            <Badge variant="outline">{totalExamples} examples</Badge>
          </div>
        </header>

        <section id="active-detectors" className="scroll-mt-24 space-y-3">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Active
          </h2>
          <DetectorGrid detectors={active} />
        </section>

        {nonActive.length > 0 && (
          <section id="planned-detectors" className="scroll-mt-24 space-y-3">
            <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
              Planned & Experimental
            </h2>
            <DetectorGrid
              detectors={nonActive.sort((a, b) => {
                const ao = LIFECYCLE_ORDER.indexOf(
                  a.catalogMeta.lifecycleStatus,
                );
                const bo = LIFECYCLE_ORDER.indexOf(
                  b.catalogMeta.lifecycleStatus,
                );
                return ao - bo || a.label.localeCompare(b.label);
              })}
            />
          </section>
        )}
      </div>
    </NextraPageShell>
  );
}

function lifecycleBadgeStyle(status: string): string {
  if (status === "active")
    return "border-green-500/40 text-green-600 dark:text-green-400";
  if (status === "experimental")
    return "border-yellow-500/40 text-yellow-600 dark:text-yellow-400";
  if (status === "deprecated") return "border-red-500/40 text-red-500";
  return "";
}

function DetectorGrid({
  detectors,
}: {
  detectors: ReturnType<typeof getAllDetectorDocs>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {detectors.map((detector) => (
        <a
          key={detector.detectorType}
          href={`/detectors/${detector.slug}`}
          className="group flex flex-col gap-2 rounded-[6px] border-2 border-border bg-card p-4 transition-colors hover:border-accent hover:bg-accent/10"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-serif text-base font-black uppercase tracking-[0.08em] text-foreground group-hover:text-accent-foreground">
              {detector.label}
            </span>
            <Badge
              variant="outline"
              className={`shrink-0 text-[10px] ${lifecycleBadgeStyle(detector.catalogMeta.lifecycleStatus)}`}
            >
              {detector.catalogMeta.lifecycleStatus}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {detector.catalogMeta.categories.map((cat) => (
              <Badge key={cat} variant="outline" className="text-[10px]">
                {cat}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{detector.catalogMeta.supportedAssetTypes.join(", ")}</span>
            <span>·</span>
            <span>{detector.examples.length} examples</span>
          </div>
        </a>
      ))}
    </div>
  );
}
