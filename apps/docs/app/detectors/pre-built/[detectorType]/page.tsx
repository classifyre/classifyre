import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getAllDetectorDocs,
  getDetectorDocBySlug,
} from "@workspace/schemas/detector-docs";

import { NextraPageShell } from "@/components/nextra-page-shell";
import { DetectorDocView } from "@/components/detector-doc-view";
import { buildDetectorDetailsCopy } from "@/lib/detector-copy";

type DetectorRouteParams = {
  detectorType: string;
};

type DetectorPageProps = {
  params: Promise<DetectorRouteParams>;
};

export function generateStaticParams(): DetectorRouteParams[] {
  return getAllDetectorDocs().map((d) => ({
    detectorType: d.slug,
  }));
}

export async function generateMetadata({
  params,
}: DetectorPageProps): Promise<Metadata> {
  const { detectorType } = await params;
  const detector = getDetectorDocBySlug(detectorType);

  if (!detector) {
    return { title: "Detector Not Found" };
  }

  return {
    title: `${detector.label} Detector`,
    description: `${detector.label} detector schema reference with parameters, examples, and raw JSON schema.`,
  };
}

export default async function DetectorTypePage({ params }: DetectorPageProps) {
  const { detectorType } = await params;
  const detector = getDetectorDocBySlug(detectorType);

  if (!detector) {
    notFound();
  }

  const toc = [
    { id: "detector-overview", value: "Overview" },
    { id: "detector-metadata", value: "Metadata" },
    { id: "parameters", value: "Parameters" },
    { id: "detector-examples", value: "Examples" },
  ];

  const sourceCode = buildDetectorDetailsCopy(detector);

  return (
    <NextraPageShell
      title={`${detector.label} Detector`}
      filePath="app/detectors/[detectorType]/page.tsx"
      toc={toc}
      sourceCode={sourceCode}
    >
      <DetectorDocView detector={detector} />
    </NextraPageShell>
  );
}
