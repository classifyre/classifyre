import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical guides from Classifyre on data access governance, dynamic masking, data quality, and self-hosted analytics.",
  alternates: { canonical: "/blog/articles" },
};

export default async function BlogArticlesPage() {
  const posts = await getPostsBySection("articles");

  return (
    <BlogSectionPage
      eyebrow="Blog"
      title="Clear rules. Masked data. Safe self-service."
      description="Practical guides for data, IT, and security teams on controlling access by role, masking sensitive data, and sharing governed datasets."
      posts={posts}
    />
  );
}
