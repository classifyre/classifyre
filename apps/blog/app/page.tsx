import Link from "next/link";

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

import { getAllPosts } from "@/lib/posts";

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export default async function HomePage() {
  const posts = await getAllPosts();
  const featured = posts.slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <section className="space-y-5">
        <Badge
          variant="secondary"
          className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
        >
          Nextra Docs Theme
        </Badge>
        <h1 className="font-serif text-5xl font-black uppercase leading-[0.92] tracking-[0.08em] sm:text-6xl">
          Classifyre Engineering Blog
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Architecture, workflow, and delivery notes in the same design language
          as the core app shell.
        </p>
        <div className="flex gap-3">
          <Button asChild className="border-2 border-border">
            <Link href="/blog">Browse archive</Link>
          </Button>
          <Button
            asChild
            variant="secondary"
            className="border-2 border-border"
          >
            <Link href="/rss.xml">Open RSS</Link>
          </Button>
        </div>
      </section>

      <Separator className="my-10" />

      <section className="grid gap-5 md:grid-cols-3">
        {featured.map((post) => (
          <Card key={post.route} className="panel-card bg-card/80">
            <CardHeader>
              <CardTitle className="text-2xl leading-tight">
                {post.title}
              </CardTitle>
              <CardDescription>{post.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{formatDate(post.date)}</Badge>
                {post.tags.slice(0, 2).map((tag) => (
                  <Badge
                    key={`${post.route}-${tag}`}
                    variant="secondary"
                    className="border border-border"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
              <Button
                asChild
                variant="secondary"
                className="w-full border-2 border-border"
              >
                <Link href={post.route}>Read article</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
