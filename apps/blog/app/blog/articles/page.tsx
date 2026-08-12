import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Business blog",
  description:
    "Ideas from Classifyre about investigation work, evidence, and turning scattered data into better decisions.",
  alternates: { canonical: "/blog/articles" },
};

export default async function BusinessBlogPage() {
  const posts = await getPostsBySection("articles");

  return (
    <BlogSectionPage
      eyebrow="Business blog"
      title="Better questions. Clearer evidence. Stronger decisions."
      description="Ideas for leaders and investigation teams working to turn scattered organizational data into evidence they can understand and act on."
      posts={posts}
    />
  );
}
