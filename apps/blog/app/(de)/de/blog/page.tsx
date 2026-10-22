import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { BlogPostCard } from "@/components/blog-post-card";
import { getAllPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog und Fallakten",
  description:
    "Notizen von Classifyre über Ermittlungsarbeit und beweisgeführte Fallakten aus echten Public-Data-Ermittlungen.",
  alternates: {
    canonical: "/de/blog/",
    languages: {
      en: "/blog/",
      de: "/de/blog/",
      "x-default": "/blog/",
    },
  },
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

export default async function BlogOverviewPageDe() {
  const posts = await getAllPosts("de");
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
            Notizen über Ermittlungsarbeit, plus Fallakten aus echten
            öffentlichen Datensätzen.
          </p>
        </div>
        <nav aria-label="Blog-Rubriken" className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/de/blog/articles/">Blog ({articleCount})</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/de/blog/cases/">Fallakten ({caseCount})</Link>
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
              <BlogPostCard post={post} locale="de" featured={featured} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
