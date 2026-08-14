import { BlogPostCard } from "@/components/blog-post-card";
import { getPostsBySection, type BlogPostSection } from "@/lib/posts";

type RelatedCasePostsProps = {
  section: BlogPostSection;
  currentPath: string;
  limit?: number;
  heading?: string;
};

/**
 * Server component (async, no "use client") so it can read the filesystem
 * post list directly via lib/posts.ts at render time — MDX pages in the app
 * router support async server components in their component tree the same
 * way any other RSC does. getPostsBySection already returns newest-first.
 */
export async function RelatedCasePosts({
  section,
  currentPath,
  limit = 3,
  heading = "More case files",
}: RelatedCasePostsProps) {
  const posts = await getPostsBySection(section);
  const related = posts.filter((post) => post.route !== currentPath).slice(0, limit);

  if (related.length === 0) return null;

  return (
    <section className="mt-16 border-t-2 border-border pt-12">
      <h2 className="mb-8 font-serif text-3xl font-black uppercase tracking-[0.04em] text-foreground sm:text-4xl">
        {heading}
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {related.map((post) => (
          <BlogPostCard key={post.route} post={post} />
        ))}
      </div>
    </section>
  );
}
