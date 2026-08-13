import Link from "next/link";

import { Badge, Button } from "@workspace/ui/components";

import { BlogPostCard } from "@/components/blog-post-card";
import type { BlogPostSummary } from "@/lib/posts";

export function BlogSectionPage({
  eyebrow,
  title,
  description,
  posts,
}: {
  eyebrow: string;
  title: string;
  description: string;
  posts: BlogPostSummary[];
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
      <header className="mb-10 border-b-2 border-border pb-8">
        <Badge className="mb-5">{eyebrow}</Badge>
        <h1 className="max-w-4xl font-serif text-4xl font-black uppercase tracking-[0.06em] sm:text-6xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {description}
        </p>
        <Button asChild variant="link" className="mt-4 px-0">
          <Link href="/blog">← Back to publication overview</Link>
        </Button>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {posts.map((post) => (
          <BlogPostCard key={post.route} post={post} />
        ))}
      </div>
    </main>
  );
}
