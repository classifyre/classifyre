/* global process */
import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

function normalizeRoute(route) {
  if (!route) return "/";
  return route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
}

function asDocsRoute(route) {
  const normalized = normalizeRoute(route);
  if (normalized === "/") {
    return "/docs";
  }

  return normalized.startsWith("/docs") ? normalized : `/docs${normalized}`;
}

function getDocsLastmod(route) {
  const normalized = asDocsRoute(route);

  let filePath;
  if (normalized === "/docs") {
    filePath = path.join(process.cwd(), "app", "page.mdx");
  } else if (normalized.startsWith("/docs/")) {
    const relative = normalized.replace("/docs/", "");
    filePath = path.join(process.cwd(), "app", relative, "page.mdx");
  } else {
    return null;
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data } = matter(raw);
    const stamp = data.lastUpdated || data.updatedAt || data.date;

    if (!stamp) {
      return null;
    }

    const parsed = new Date(stamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch {
    return null;
  }
}

/** @type {import("next-sitemap").IConfig} */
const config = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://classifyre.local",
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

    if (normalized === "/404" || normalized === "/500" || normalized === "/_not-found") {
      return null;
    }

    const docsRoute = asDocsRoute(route);

    let priority = config.priority;
    let changefreq = config.changefreq;

    if (docsRoute === "/docs") {
      priority = 0.9;
      changefreq = "daily";
    } else if (docsRoute === "/docs/get-started") {
      priority = 0.85;
      changefreq = "weekly";
    }

    return {
      loc: docsRoute,
      changefreq,
      priority,
      lastmod: getDocsLastmod(docsRoute) || (config.autoLastmod ? new Date().toISOString() : undefined),
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
