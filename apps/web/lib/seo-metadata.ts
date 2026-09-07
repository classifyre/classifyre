/**
 * The one place page metadata is built.
 *
 * Every `generateMetadata` / `metadata` export in `app/[locale]/**` goes
 * through `siteMetadata`, `sectionMetadata` or `entityMetadata`, so the rules
 * below hold for all 30 of them instead of being restated (and drifting) per
 * file:
 *
 *  - Copy comes from the route locale, never from a hardwired `@/i18n/en`.
 *  - `robots` follows `SITEMAP_ENABLED`. A Classifyre instance is private by
 *    default (`helm/values.yaml` → `frontend.sitemap.enabled: false`), and
 *    `renderRobots()` serves `Disallow: /` in that case — inviting indexing
 *    from the page head would contradict the file crawlers actually read.
 *  - The origin is resolved at *request* time. `process.env.PUBLIC_BASE_URL`
 *    read at module scope is inlined by Next when the image is built in CI,
 *    long before Helm supplies any value, which is how a self-hosted instance
 *    ends up declaring `https://classifyre.com` as its own canonical. See the
 *    same workaround in `lib/sitemap-config.ts` and `app/classifyre-cfg`.
 */

import type { Metadata } from "next";

import { translateFor } from "@/i18n";
import {
  DEFAULT_LOCALE,
  LOCALES,
  localeOpenGraph,
  localePathPrefix,
  type Locale,
} from "@/lib/locale-detection";
import { isSitemapEnabled, resolveBaseUrl } from "@/lib/sitemap-config";

/** The static export has no server, no request headers and no crawler. */
const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

/** Where a page sits, in locale-independent terms. */
export interface PageLocation {
  /** Workspace slug, when the page lives inside one. */
  namespaceSlug?: string;
  /** Path below the workspace root, e.g. "/assets" or "/assets/<id>". */
  path?: string;
}

/**
 * Reads an env var without letting Next inline it at build time — same reason
 * as `readEnv` in `lib/sitemap-config.ts`.
 */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * The public origin, or null when it cannot be known.
 *
 * An explicit override is preferred because reading it keeps the route
 * statically renderable; falling back to the request headers is correct on any
 * hostname but opts the route into dynamic rendering, which is the right
 * trade only when nothing else can supply the origin.
 */
async function resolveConfiguredBaseUrl(): Promise<string | null> {
  if (isDesktopBuild) return null;

  const override = readEnv("SITEMAP_BASE_URL") ?? readEnv("PUBLIC_BASE_URL");
  if (override) return override.trim().replace(/\/+$/, "");

  try {
    const { headers } = await import("next/headers");
    return resolveBaseUrl(await headers());
  } catch {
    // Prerender, or a context with no request. Absolute URLs are simply
    // omitted; a page must never fail to render over its own canonical tag.
    return null;
  }
}

/**
 * Canonical app path for a location in a locale.
 *
 * `next.config.mjs` sets `trailingSlash: true`, so the slash-terminated form is
 * the one that does not redirect — the same rule `appUrl()` follows for the
 * sitemap.
 */
function canonicalPath(locale: Locale, location: PageLocation): string {
  const namespace = location.namespaceSlug
    ? `/${encodeURIComponent(location.namespaceSlug)}`
    : "";
  const rest = location.path && location.path !== "/" ? location.path : "";
  const path = `${localePathPrefix(locale)}${namespace}${rest}`;
  return path === "" ? "/" : `${path}/`;
}

/** `alternates`, absolute when the origin is known and omitted when it is not. */
function alternates(
  baseUrl: string | null,
  locale: Locale,
  location: PageLocation,
): Metadata["alternates"] {
  if (!baseUrl) return undefined;

  const languages = Object.fromEntries(
    LOCALES.map((candidate) => [
      candidate,
      `${baseUrl}${canonicalPath(candidate, location)}`,
    ]),
  );

  return {
    canonical: `${baseUrl}${canonicalPath(locale, location)}`,
    languages: {
      ...languages,
      // The unprefixed default is what a crawler with no language preference
      // should land on.
      "x-default": `${baseUrl}${canonicalPath(DEFAULT_LOCALE, location)}`,
    },
  };
}

/**
 * Indexing directives. Opt-in per deployment, and never overriding a page that
 * has declared itself private (source/detector creation and edit forms).
 */
function robots(): Metadata["robots"] {
  if (!isSitemapEnabled()) return { index: false, follow: false };
  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

/** `robots` for a page that must never be indexed regardless of the setting. */
export const NO_INDEX: Metadata["robots"] = { index: false, follow: false };

/** Root-layout metadata: site-wide defaults every page inherits. */
export async function siteMetadata(locale: Locale): Promise<Metadata> {
  const baseUrl = await resolveConfiguredBaseUrl();
  const t = (key: string) => translateFor(locale, key);

  return {
    ...(baseUrl ? { metadataBase: new URL(baseUrl) } : {}),
    title: {
      template: `%s | ${t("app.name")}`,
      default: t("seo.site.title"),
    },
    description: t("seo.site.description"),
    keywords: t("seo.site.keywords").split(", "),
    authors: [{ name: "Classifyre", ...(baseUrl ? { url: baseUrl } : {}) }],
    creator: "Classifyre",
    publisher: "Classifyre",
    category: "Technology",
    openGraph: {
      type: "website",
      locale: localeOpenGraph(locale),
      siteName: t("app.name"),
      title: t("seo.site.ogTitle"),
      description: t("seo.site.ogDescription"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("seo.site.twitterTitle"),
      description: t("seo.site.twitterDescription"),
      creator: "@classifyre",
    },
    robots: robots(),
    manifest: "/manifest.json",
  };
}

/**
 * Metadata for a static section — a list page, a form, a settings screen.
 *
 * `key` is the `seo.*` namespace holding `title`, `description`, `ogTitle` and
 * `ogDescription` (e.g. `"seo.assets"`).
 */
export async function sectionMetadata(
  locale: Locale,
  key: string,
  location: PageLocation = {},
): Promise<Metadata> {
  const baseUrl = await resolveConfiguredBaseUrl();
  const t = (suffix: string) => translateFor(locale, `${key}.${suffix}`);

  return {
    title: t("title"),
    description: t("description"),
    alternates: alternates(baseUrl, locale, location),
    openGraph: {
      locale: localeOpenGraph(locale),
      title: t("ogTitle"),
      description: t("ogDescription"),
    },
  };
}

/**
 * Metadata for a detail page.
 *
 * `entityName` is the entity's real display name. When it is unknown — the
 * static-export placeholder shell, a lookup that timed out, an id that no
 * longer resolves — this falls back to the generic section copy rather than
 * interpolating a raw UUID into a `<title>`, which reads worse than the
 * generic title and is worth nothing to a crawler.
 *
 * The `*WithEntity` templates take exactly one placeholder, `{{name}}`; see
 * `lib/i18n-keys.spec.ts`, which fails the build if a template asks for a
 * placeholder this function does not supply.
 */
export async function entityMetadata(
  locale: Locale,
  key: string,
  entityName: string | null,
  location: PageLocation = {},
): Promise<Metadata> {
  if (!entityName) return sectionMetadata(locale, key, location);

  const baseUrl = await resolveConfiguredBaseUrl();
  const title = translateFor(locale, `${key}.titleWithEntity`, {
    name: entityName,
  });
  const description = translateFor(locale, `${key}.descriptionWithEntity`, {
    name: entityName,
  });

  return {
    title,
    description,
    alternates: alternates(baseUrl, locale, location),
    openGraph: {
      locale: localeOpenGraph(locale),
      title,
      description,
    },
  };
}
