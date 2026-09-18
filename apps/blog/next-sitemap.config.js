/* global process */
import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

const DEFAULT_LOCALE = "en";

function normalizeRoute(route) {
  if (!route) return "/";
  return route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
}

function splitLocale(route) {
  const normalized = normalizeRoute(route);
  const segments = normalized.split("/").filter(Boolean);
  if (segments[0] === "de") {
    const rest = `/${segments.slice(1).join("/")}`;
    return { locale: "de", rest: rest === "/" ? "/" : rest };
  }
  return { locale: "en", rest: normalized };
}

/** The same page in the other locale (`/sources` ↔ `/de/sources`). */
function alternateRoute(route) {
  const { locale, rest } = splitLocale(route);
  const target = locale === "de" ? DEFAULT_LOCALE : "de";
  const suffix = rest === "/" ? "" : rest;
  return target === DEFAULT_LOCALE ? suffix || "/" : `/de${suffix}`;
}

function outFileForRoute(outDir, route) {
  const normalized = normalizeRoute(route);
  const relative = normalized === "/" ? "index.html" : `${normalized.slice(1)}/index.html`;
  return path.join(outDir, relative);
}

function routeExistsInExport(outDir, route) {
  return fs.existsSync(outFileForRoute(outDir, route));
}

function mdxFileForRoute(route) {
  const { locale, rest } = splitLocale(route);
  if (!rest.startsWith("/blog/")) return null;
  const pieces = rest.split("/").filter(Boolean);
  if (pieces.length < 3) return null;
  const contentRoot =
    locale === "de"
      ? path.join(process.cwd(), "app", "(de)", "de", "blog")
      : path.join(process.cwd(), "app", "(en)", "blog");
  // rest is `/blog/<section>/<slug>` — resolve the section dir + slug.
  const [, section, slug] = pieces;
  return path.join(contentRoot, section, slug, "page.mdx");
}

function getBlogPostDate(route) {
  const filePath = mdxFileForRoute(route);
  if (!filePath || !fs.existsSync(filePath)) {
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

/**
 * `hreflang` alternates for a route. Every German URL has an English
 * counterpart by construction (untranslated pages fall back to English
 * content), so pairs are near-always complete; when a counterpart is missing
 * from the export it is left out rather than advertised to crawlers.
 */
function alternateRefsForRoute(config, outDir, route) {
  const { locale } = splitLocale(route);
  const counterpart = alternateRoute(route);
  const refs = [];
  const self = locale === "de" ? "de" : "en";

  // NOTE: `hrefIsAbsolute` is load-bearing — without it next-sitemap resolves
  // the href against `loc` and the sitemap ends up with doubled paths.
  refs.push({
    href: `${config.siteUrl}${normalizeRoute(route) === "/" ? "/" : `${normalizeRoute(route)}/`}`,
    hreflang: self,
    hrefIsAbsolute: true,
  });

  if (routeExistsInExport(outDir, counterpart)) {
    const other = counterpart === "/" ? "/" : `${normalizeRoute(counterpart)}/`;
    refs.push({
      href: `${config.siteUrl}${other}`,
      hreflang: locale === "de" ? "en" : "de",
      hrefIsAbsolute: true,
    });
  }

  // x-default is the language-neutral entry point: the unprefixed URL, which
  // itself redirects German browsers via the client-side locale script.
  const entryPoint = locale === "de" ? counterpart : route;
  const entry = normalizeRoute(entryPoint) === "/" ? "/" : `${normalizeRoute(entryPoint)}/`;
  if (!refs.some((ref) => ref.hreflang === "x-default")) {
    refs.push({
      href: `${config.siteUrl}${entry}`,
      hreflang: "x-default",
      hrefIsAbsolute: true,
    });
  }

  return refs;
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
  exclude: ["/api/*", "/_next/*", "/404", "/500", "/download", "/de/download"],
  alternateRefs: [],
  transform: async (config, route) => {
    if (route.includes("/_next/") || route.includes("/api/")) {
      return null;
    }

    // /download (and its German twin) are noindex stubs that only redirect to
    // /get — kept for links that shipped before the rename. Advertising them
    // would point crawlers at pages whose whole job is to send them elsewhere.
    const normalized = normalizeRoute(route);
    if (normalized === "/download" || normalized === "/de/download") {
      return null;
    }

    let priority = config.priority;
    let changefreq = config.changefreq;
    let lastmod;

    const { rest } = splitLocale(route);
    if (rest === "/") {
      priority = 1.0;
      changefreq = "daily";
    } else if (rest === "/blog") {
      priority = 0.9;
      changefreq = "daily";
    } else if (rest.startsWith("/blog/")) {
      priority = 0.8;
      changefreq = "weekly";
      lastmod = getBlogPostDate(route);
    } else if (normalized === "/rss.xml") {
      priority = 0.4;
      changefreq = "daily";
    }

    const outDir = path.join(process.cwd(), config.sourceDir || "out");

    return {
      loc: route,
      changefreq,
      priority,
      lastmod: lastmod || (config.autoLastmod ? new Date().toISOString() : undefined),
      alternateRefs: alternateRefsForRoute(config, outDir, route),
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
