import { getAllPosts } from "@/lib/posts";
import { normalizeSiteUrl } from "@/lib/seo";

const siteUrl = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
);

export const revalidate = 3600;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET() {
  const posts = await getAllPosts();

  const items = posts
    .map((post) => {
      const link = `${siteUrl}${post.route}`;
      const date = new Date(post.date);
      const pubDate = Number.isNaN(date.getTime())
        ? new Date().toUTCString()
        : date.toUTCString();

      return `<item>
  <title>${escapeXml(post.title)}</title>
  <description>${escapeXml(post.description)}</description>
  <link>${link}</link>
  <guid>${link}</guid>
  <pubDate>${pubDate}</pubDate>
</item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Classifyre Engineering Blog</title>
  <link>${siteUrl}</link>
  <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml" />
  <description>Long-form engineering writing from the Classifyre workspace.</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  ${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=UTF-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
