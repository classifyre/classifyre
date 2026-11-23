import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Case files",
  description:
    "Hands-on Classifyre walkthroughs and field notes on real public datasets and governance scenarios.",
  alternates: { canonical: "/blog/cases" },
};

export default async function CaseFilesPage() {
  const posts = await getPostsBySection("cases");

  return (
    <BlogSectionPage
      eyebrow="Case files"
      title="Real datasets. Clear walkthroughs."
      description="Hands-on walkthroughs on real public datasets and governance scenarios — showing what Classifyre finds, how rules apply, and what teams can verify directly."
      posts={posts}
    />
  );
}
