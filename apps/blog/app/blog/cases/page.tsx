import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Investigation case files",
  description:
    "Evidence-led Classifyre field notes from investigations of real public datasets.",
  alternates: { canonical: "/blog/cases" },
};

export default async function CaseFilesPage() {
  const posts = await getPostsBySection("cases");

  return (
    <BlogSectionPage
      eyebrow="Case files"
      title="Investigations you can inspect."
      description="Field notes from real public datasets: what Classifyre found, which questions it opened, and where human judgment still matters."
      posts={posts}
    />
  );
}
