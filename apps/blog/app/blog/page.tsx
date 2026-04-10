import Link from "next/link";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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

export default async function BlogArchivePage() {
  const posts = await getAllPosts();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 space-y-3">
        <Badge
          variant="secondary"
          className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
        >
          Journal
        </Badge>
        <h1 className="font-serif text-4xl font-black uppercase tracking-[0.08em] sm:text-5xl">
          Engineering Journal
        </h1>
        <p className="text-muted-foreground">
          Product notes, detector design, deployment guidance, and engineering
          write-ups.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {posts.map((post) => (
          <Card key={post.route} className="panel-card">
            <CardHeader className="space-y-3">
              <CardTitle className="text-2xl leading-tight">
                {post.title}
              </CardTitle>
              <CardDescription>{post.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{formatDate(post.date)}</Badge>
                {post.categories.slice(0, 1).map((category) => (
                  <Badge
                    key={`${post.route}-${category}`}
                    variant="secondary"
                    className="border border-border"
                  >
                    {category}
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
