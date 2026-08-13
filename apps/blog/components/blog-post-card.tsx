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

  return (
    <Card className="panel-card h-full justify-between">
      <div>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sectionLabel}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {formatPostDate(post.date)}
            </span>
          </div>
          <CardTitle className="text-2xl leading-tight sm:text-3xl">
            {post.title}
          </CardTitle>
          <CardDescription className="text-base">
            {post.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pb-4">
          {post.tags.slice(0, 3).map((tag) => (
            <Badge key={`${post.route}-${tag}`} variant="outline">
              {tag}
            </Badge>
          ))}
        </CardContent>
      </div>
      <CardContent>
        <Button asChild variant="secondary" className="w-full border-2 border-border">
          <Link href={post.route}>
            {post.section === "cases" ? "Open case file" : "Read article"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
