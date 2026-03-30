import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NextraPageShell } from "@/components/nextra-page-shell";
import { SourceDocView } from "@/components/source-doc-view";
import { buildSourceDetailsCopy } from "@/lib/source-copy";
import {
  getAllSourceDocs,
  getSourceDocBySlug,
} from "@workspace/schemas/source-docs";

type SourceRouteParams = {
  sourceType: string;
};

type SourcePageProps = {
  params: Promise<SourceRouteParams>;
};

export function generateStaticParams(): SourceRouteParams[] {
  return getAllSourceDocs().map((source) => ({
    sourceType: source.slug,
  }));
}

export async function generateMetadata({
  params,
}: SourcePageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const sourceDoc = getSourceDocBySlug(resolvedParams.sourceType);

  if (!sourceDoc) {
    return {
      title: "Source Not Found",
    };
  }

  return {
    title: `${sourceDoc.label} Source`,
    description: `${sourceDoc.label} source schema reference with table view, raw JSON schema, and configuration examples.`,
  };
}

export default async function SourceTypePage({ params }: SourcePageProps) {
  const resolvedParams = await params;
  const sourceDoc = getSourceDocBySlug(resolvedParams.sourceType);

  if (!sourceDoc) {
    notFound();
  }

  const toc = [
    { id: "source-overview", value: "Overview" },
    ...(sourceDoc.knowledgeSections.length > 0
      ? [{ id: "common-questions", value: "Commonly Asked Questions" }]
      : []),
    { id: "schema-reference", value: "Schema Reference" },
    { id: "required-fields", value: "Required Fields" },
    { id: "masked-fields", value: "Masked Fields" },
    { id: "optional-fields", value: "Optional Fields" },
    { id: "source-examples", value: "Examples" },
  ];
  const sourceCode = buildSourceDetailsCopy(sourceDoc);

  return (
    <NextraPageShell
      title={`${sourceDoc.label} Source`}
      filePath="app/sources/[sourceType]/page.tsx"
      toc={toc}
      sourceCode={sourceCode}
    >
      <SourceDocView source={sourceDoc} />
    </NextraPageShell>
  );
}
