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
  title: "Blog und Ermittlungs-Fallakten",
  description:
    "Business-Perspektiven von Classifyre und beweisgeführte Fallakten aus echten Public-Data-Ermittlungen.",
  alternates: {
    canonical: "/de/blog/",
    languages: {
      en: "/blog/",
      de: "/de/blog/",
      "x-default": "/blog/",
    },
  },
};

const sectionCopy: Record<
  BlogPostSection,
  { index: string; title: string; description: string; href: string }
> = {
  articles: {
    index: "01",
    title: "Business-Blog",
    description:
      "Praktische Ideen über Ermittlungsarbeit, Beweise und wie aus verstreuten Daten Entscheidungen werden.",
    href: "/de/blog/articles/",
  },
  cases: {
    index: "02",
    title: "Fallakten",
    description:
      "Beweisgeführte Feldnotizen, die zeigen, wie Classifyre echte öffentliche Datensätze untersucht.",
    href: "/de/blog/cases/",
  },
};

export default async function BlogOverviewPageDe() {
  const posts = await getAllPosts("de");
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
            <Badge className="w-fit">Classifyre-Publikation</Badge>
            <div className="space-y-4">
              <h1 className="max-w-4xl font-serif text-4xl leading-[0.95] font-black uppercase tracking-[0.06em] text-foreground sm:text-6xl lg:text-7xl">
                Ideen, Beweise und bessere Ermittlungen.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Lesen Sie das Business-Denken hinter Classifyre und steigen Sie
                dann in echte Fallakten ein, um zu sehen, wie die
                Ermittlungsplattform in der Praxis arbeitet.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/de/blog/articles/">Blog entdecken</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/de/blog/cases/">Fallakten durchstöbern</Link>
              </Button>
            </div>
          </CardHeader>

          <aside className="border-t-2 border-border bg-muted/35 p-6 lg:border-t-0 lg:border-l-2 lg:p-8">
            <p className="mb-6 font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Publikationsindex
            </p>
            <div className="space-y-5">
              <PublicationStat
                label="Business-Artikel"
                value={articlePosts.length}
                latestDate={articlePosts[0]?.date}
              />
              <Separator />
              <PublicationStat
                label="Fallakten"
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
              Rubrik wählen
            </p>
            <h2
              id="publication-sections"
              className="font-serif text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl"
            >
              Zwei Arten zu lesen
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
                      {sectionPosts.length}{" "}
                      {sectionPosts.length === 1 ? "Eintrag" : "Einträge"}
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
                        Aktuell
                      </p>
                      <p className="mt-1 font-semibold text-foreground">
                        {latest.title}
                      </p>
                    </div>
                  ) : null}
                  <Button asChild variant="outline" className="w-full">
                    <Link href={copy.href}>
                      {section === "articles" ? "Blog ansehen" : "Fallakten ansehen"}
                    </Link>
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
            Kürzlich erschienen
          </p>
          <h2
            id="latest-publications"
            className="font-serif text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl"
          >
            Neues von Classifyre
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {latestPosts.map((post) => (
            <BlogPostCard key={post.route} post={post} locale="de" />
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
        {latestDate ? `Aktuell ${formatPostDate(latestDate, "de")}` : "Demnächst"}
      </span>
    </div>
  );
}
