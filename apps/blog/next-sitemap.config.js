/* global process */
import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

function normalizeRoute(route) {
  if (!route) return "/";
  return route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
}

function getBlogPostDate(route) {
  const normalized = normalizeRoute(route);

  if (!normalized.startsWith("/blog/")) {
    return null;
  }

  const pieces = normalized.split("/").filter(Boolean);
  if (pieces.length < 3) {
    return null;
  }

  const yearMonth = pieces[1];
  const slug = pieces[2];
  const filePath = path.join(process.cwd(), "app", "blog", yearMonth, slug, "page.mdx");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data } = matter(raw);

    if (!data.date) {
      return null;
    }

    const parsed = new Date(data.date);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch {
    return null;
  }
}

/** @type {import("next-sitemap").IConfig} */
const config = {
  siteUrl: process.env.NEXT_PUBLIC_BLOG_SITE_URL || "https://blog.classifyre.local",
  generateRobotsTxt: true,
  output: "export",
  outDir: "out",
  sourceDir: "out",
  changefreq: "weekly",
  priority: 0.7,
  sitemapSize: 5000,
  exclude: ["/api/*", "/_next/*", "/404", "/500"],
  transform: async (config, route) => {
    if (route.includes("/_next/") || route.includes("/api/")) {
      return null;
    }

    const normalized = normalizeRoute(route);

    let priority = config.priority;
    let changefreq = config.changefreq;
    let lastmod;

    if (normalized === "/") {
      priority = 1.0;
      changefreq = "daily";
    } else if (normalized === "/blog") {
      priority = 0.9;
      changefreq = "daily";
    } else if (normalized.startsWith("/blog/")) {
      priority = 0.8;
      changefreq = "weekly";
      lastmod = getBlogPostDate(route);
    } else if (normalized === "/rss.xml") {
      priority = 0.4;
      changefreq = "daily";
    }

    return {
      loc: route,
      changefreq,
      priority,
      lastmod: lastmod || (config.autoLastmod ? new Date().toISOString() : undefined),
      alternateRefs: config.alternateRefs ?? [],
    };
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
      },
      {
        userAgent: "*",
        disallow: ["/_next/", "/api/"],
      },
    ],
  },
};

export default config;
