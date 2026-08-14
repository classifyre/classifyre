import Link from "next/link";

import { Badge, Card, CardContent, CardHeader } from "@workspace/ui/components";

import type { BlogPostSummary } from "@/lib/posts";

export function formatPostDate(date: string): string {
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

export function BlogPostCard({ post }: { post: BlogPostSummary }) {
  const sectionLabel = post.section === "cases" ? "Case file" : "Business blog";
  const ctaLabel = post.section === "cases" ? "Open case file" : "Read article";

  return (
    <Link href={post.route} className="group block h-full no-underline">
      <Card className="panel-card h-full justify-between overflow-hidden py-0 transition-transform duration-200 group-hover:-translate-x-1 group-hover:-translate-y-1">
        <div>
          <div className="relative h-48 w-full overflow-hidden border-b-2 border-border bg-muted sm:h-52">
            {post.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.image}
                alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/70 via-stone-950/10 to-transparent" />
            <div className="absolute left-3 top-3">
              <Badge>{sectionLabel}</Badge>
            </div>
          </div>

          <CardHeader className="space-y-3 pt-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {formatPostDate(post.date)}
            </span>
            <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.02em] text-foreground sm:text-3xl">
              {post.title}
            </h3>
            <p className="line-clamp-3 text-base leading-6 text-muted-foreground">
              {post.description}
            </p>
          </CardHeader>
        </div>
        <CardContent className="pb-5">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            {ctaLabel}
            <span className="transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
