import Link from "next/link";
import type { Metadata } from "next";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@workspace/ui/components";

import { BlogPostCard, formatPostDate } from "@/components/blog-post-card";
import { getAllPosts, type BlogPostSection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog and investigation case files",
  description:
    "Business perspectives from Classifyre and evidence-led case files from real public-data investigations.",
  alternates: { canonical: "/blog" },
};

const sectionCopy: Record<
  BlogPostSection,
  { index: string; title: string; description: string; href: string }
> = {
  articles: {
    index: "01",
    title: "Business blog",
    description:
      "Practical ideas about investigation work, evidence, and turning scattered data into decisions.",
    href: "/blog/articles",
  },
  cases: {
    index: "02",
    title: "Case files",
    description:
      "Evidence-led field notes showing how Classifyre investigates real public datasets.",
    href: "/blog/cases",
  },
};

export default async function BlogOverviewPage() {
  const posts = await getAllPosts();
  const articlePosts = posts.filter((post) => post.section === "articles");
  const casePosts = posts.filter((post) => post.section === "cases");
  const groupedPosts = { articles: articlePosts, cases: casePosts };
  const latestPosts = posts.slice(0, 4);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
      <Card className="relative mb-14 overflow-hidden p-0">
        <div className="h-2 w-full bg-accent" />
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.7fr)]">
          <CardHeader className="gap-6 px-6 py-9 sm:px-9 sm:py-12">
            <Badge className="w-fit">Classifyre publication</Badge>
            <div className="space-y-4">
              <h1 className="max-w-4xl font-serif text-4xl leading-[0.95] font-black uppercase tracking-[0.06em] text-foreground sm:text-6xl lg:text-7xl">
                Ideas, evidence, and better investigations.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Read the business thinking behind Classifyre, then step inside
                real case files to see how the investigation platform works in
                practice.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/blog/articles">Explore the blog</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/blog/cases">Browse case files</Link>
              </Button>
            </div>
          </CardHeader>

          <aside className="border-t-2 border-border bg-muted/35 p-6 lg:border-t-0 lg:border-l-2 lg:p-8">
            <p className="mb-6 font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Publication index
            </p>
            <div className="space-y-5">
              <PublicationStat
                label="Business articles"
                value={articlePosts.length}
                latestDate={articlePosts[0]?.date}
              />
              <Separator />
              <PublicationStat
                label="Case files"
                value={casePosts.length}
                latestDate={casePosts[0]?.date}
              />
            </div>
          </aside>
        </div>
      </Card>

      <section aria-labelledby="publication-sections" className="mb-14">
        <div className="mb-6 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Choose a section
            </p>
            <h2
              id="publication-sections"
              className="font-serif text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl"
            >
              Two ways to read
            </h2>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {(["articles", "cases"] as const).map((section) => {
            const copy = sectionCopy[section];
            const sectionPosts = groupedPosts[section];
            const latest = sectionPosts[0];

            return (
              <Card key={section} clickable className="group h-full">
                <CardHeader className="gap-5">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-mono text-4xl font-bold text-accent [-webkit-text-stroke:1px_var(--color-border)]">
                      {copy.index}
                    </span>
                    <Badge variant="secondary">
                      {sectionPosts.length} {sectionPosts.length === 1 ? "entry" : "entries"}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <CardTitle className="text-3xl">{copy.title}</CardTitle>
                    <CardDescription className="text-base">
                      {copy.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="mt-auto space-y-5">
                  {latest ? (
                    <div className="border-l-4 border-accent pl-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Latest
                      </p>
                      <p className="mt-1 font-semibold text-foreground">
                        {latest.title}
                      </p>
                    </div>
                  ) : null}
                  <Button asChild variant="outline" className="w-full">
                    <Link href={copy.href}>View {copy.title.toLowerCase()}</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="latest-publications">
        <div className="mb-6">
          <p className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Recently published
          </p>
          <h2
            id="latest-publications"
            className="font-serif text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl"
          >
            Latest from Classifyre
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {latestPosts.map((post) => (
            <BlogPostCard key={post.route} post={post} />
          ))}
        </div>
      </section>
    </main>
  );
}

function PublicationStat({
  label,
  value,
  latestDate,
}: {
  label: string;
  value: number;
  latestDate?: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-end gap-x-4 gap-y-1">
      <strong className="row-span-2 font-serif text-5xl font-black leading-none text-foreground">
        {String(value).padStart(2, "0")}
      </strong>
      <span className="font-mono text-xs font-bold uppercase tracking-[0.1em]">
        {label}
      </span>
      <span className="text-xs text-muted-foreground">
        {latestDate ? `Latest ${formatPostDate(latestDate)}` : "Coming soon"}
      </span>
    </div>
  );
}
