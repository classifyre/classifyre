import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { BlogPostCard } from "@/components/blog-post-card";
import { getAllPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog and case files",
  description:
    "Notes from Classifyre on investigation work and evidence-led case files from real public-data investigations.",
  alternates: { canonical: "/blog" },
};

/** Varied spans so the grid reads like an editorial index, not a uniform list. */
const GRID_PATTERN = [
  "md:col-span-12 lg:col-span-7",
  "md:col-span-12 lg:col-span-5",
  "md:col-span-6 lg:col-span-5",
  "md:col-span-6 lg:col-span-7",
  "md:col-span-6 lg:col-span-4",
  "md:col-span-6 lg:col-span-4",
  "md:col-span-6 lg:col-span-4",
  "md:col-span-12 lg:col-span-6",
  "md:col-span-12 lg:col-span-6",
];

export default async function BlogOverviewPage() {
  const posts = await getAllPosts();
  const articleCount = posts.filter((post) => post.section === "articles").length;
  const caseCount = posts.filter((post) => post.section === "cases").length;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b-2 border-border pb-6">
        <div>
          <h1 className="font-serif text-4xl font-black uppercase tracking-[0.06em] sm:text-5xl">
            Blog
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
            Notes on investigation work, plus case files from real public
            datasets.
          </p>
        </div>
        <nav aria-label="Blog sections" className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/blog/articles">Blog ({articleCount})</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/blog/cases">Case files ({caseCount})</Link>
          </Button>
        </nav>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
        {posts.map((post, index) => {
          const spanClass =
            GRID_PATTERN[index % GRID_PATTERN.length] ??
            "md:col-span-12 lg:col-span-6";
          const featured = spanClass.includes("lg:col-span-7");

          return (
            <div key={post.route} className={spanClass}>
              <BlogPostCard post={post} featured={featured} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
