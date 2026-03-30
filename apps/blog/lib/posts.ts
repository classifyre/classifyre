import path from "node:path";
import { promises as fs } from "node:fs";

import matter from "gray-matter";

export type BlogPostSummary = {
  title: string;
  description: string;
  date: string;
  tags: string[];
  categories: string[];
  image?: string;
  author?: string;
  route: string;
};

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
const BLOG_DIR = path.join(APP_DIR, "blog");

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
): BlogPostSummary {
  const routeDir = path
    .dirname(path.relative(APP_DIR, filePath))
    .replace(/\\/g, "/");
  const route = `/${routeDir}`;

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

export async function getAllPosts(): Promise<BlogPostSummary[]> {
  const files = await listMdxPageFiles(BLOG_DIR);

  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, "utf8");
      const { data } = matter(raw);

      return toPostSummary(filePath, data as BlogFrontmatter);
    }),
  );

  return sortNewestFirst(parsed);
}
