import path from "node:path";
import { promises as fs } from "node:fs";

import matter from "gray-matter";

import { DEFAULT_LOCALE, type Locale } from "./locale";

export type BlogPostSummary = {
  title: string;
  description: string;
  date: string;
  tags: string[];
  categories: string[];
  image?: string;
  author?: string;
  route: string;
  section: BlogPostSection;
};

export type BlogPostSection = "articles" | "cases";

type BlogFrontmatter = {
  title?: string;
  description?: string;
  date?: string;
  tags?: string[];
  categories?: string[];
  image?: string;
  author?: string;
};

const APP_DIR = path.join(process.cwd(), "app");

/**
 * Content roots per locale. English lives in the `(en)` route group,
 * German in `(de)/de` — route groups are transparent to URLs but not to the
 * filesystem, so each locale scans its own tree. The English index never
 * lists German posts and vice versa.
 */
function blogDirForLocale(locale: Locale): string {
  return locale === DEFAULT_LOCALE
    ? path.join(APP_DIR, "(en)", "blog")
    : path.join(APP_DIR, "(de)", "de", "blog");
}

function routePrefixForLocale(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : "/de";
}

async function listMdxPageFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listMdxPageFiles(absolutePath);
      }

      if (entry.isFile() && entry.name === "page.mdx") {
        return [absolutePath];
      }

      return [];
    }),
  );

  return files.flat();
}

function toPostSummary(
  filePath: string,
  frontmatter: BlogFrontmatter,
  locale: Locale,
): BlogPostSummary {
  const contentRoot = blogDirForLocale(locale);
  const routeDir = path
    .dirname(path.relative(contentRoot, filePath))
    .replace(/\\/g, "/");
  // `contentRoot` is the `blog` folder itself, so `routeDir` is
  // `cases/<slug>` — re-add the `/blog` segment dropped by `relative`.
  const route = `${routePrefixForLocale(locale)}/blog/${routeDir}`;
  const section: BlogPostSection =
    route.startsWith("/blog/cases/") || route.startsWith("/de/blog/cases/")
      ? "cases"
      : "articles";

  return {
    title: frontmatter.title ?? "Untitled",
    description: frontmatter.description ?? "",
    date: frontmatter.date ?? "1970-01-01",
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    categories: Array.isArray(frontmatter.categories)
      ? frontmatter.categories
      : [],
    image: frontmatter.image,
    author: frontmatter.author,
    route,
    section,
  };
}

function sortNewestFirst(posts: BlogPostSummary[]): BlogPostSummary[] {
  return posts.sort((left, right) => {
    const leftDate = new Date(left.date).getTime();
    const rightDate = new Date(right.date).getTime();

    if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
      return right.date.localeCompare(left.date);
    }

    return rightDate - leftDate;
  });
}

export async function getAllPosts(
  locale: Locale = DEFAULT_LOCALE,
): Promise<BlogPostSummary[]> {
  const files = await listMdxPageFiles(blogDirForLocale(locale));

  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, "utf8");
      const { data } = matter(raw);

      return toPostSummary(filePath, data as BlogFrontmatter, locale);
    }),
  );

  return sortNewestFirst(parsed);
}

export async function getPostsBySection(
  section: BlogPostSection,
  locale: Locale = DEFAULT_LOCALE,
): Promise<BlogPostSummary[]> {
  const posts = await getAllPosts(locale);
  return posts.filter((post) => post.section === section);
}
