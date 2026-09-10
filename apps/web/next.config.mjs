import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors `LOCALES` / `DEFAULT_LOCALE` in `apps/web/lib/locale-detection.ts`.
// Duplicated because next.config.mjs is loaded by the Next CLI before any
// TypeScript path aliases exist; `lib/locale-detection.spec.ts` pins the two
// lists together.
const LOCALES = ["en", "de"];
const DEFAULT_LOCALE = "en";
const LOCALE_ALTERNATION = LOCALES.join("|");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@workspace/ui"],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === "1",
  },
  allowedDevOrigins: ["127.0.0.1", "localhost", "classifyre.localhost"],
    // The documentation site (apps/docs) is a static export copied into
    // `public/docs` by `bun run docs:bundle`, so every page of it is a
    // directory holding an `index.html`. Next's public-file handler only serves
    // *exact* paths — `/docs/how-it-works/index.html` resolves, `/docs/how-it-works/`
    // does not — so on the server deployments (Kubernetes, `next start`) the
    // whole bundled site 404s.
    //
    // `afterFiles` (not `beforeFiles`) is what makes this safe: it runs only
    // once the filesystem has failed to match, so real files — the docs site's
    // own `_next` chunks, `_pagefind` search index, images — are still served
    // directly and never get an `/index.html` glued onto them.
    async rewrites() {
      return {
        // Locale routing. Every *page* lives under `app/[locale]/…`, but the
        // default locale is served unprefixed (`/acme/findings`, not
        // `/en/acme/findings`) so no URL that shipped before locale routing
        // has to redirect. `beforeFiles` runs ahead of the filesystem, which
        // is what lets `/acme/findings` reach the `[locale]` tree at all.
        //
        // The negative lookahead lists everything that is NOT a localized
        // page: the already-prefixed locales, the route handlers that keep
        // their exact URLs, Next's own assets, file-based metadata, and any
        // top-level static file served straight out of `public/` (matched by
        // `[^/]+\.[a-zA-Z0-9]+$` — a single path segment ending in a file
        // extension, e.g. `clasifyre_icon.png`). Without that last branch,
        // requests for public/ assets that aren't individually enumerated
        // here get rewritten to `/en/<file>` and 404 (this broke the sidebar
        // and topbar logo — see git history on this file).
        // `docs/.` (a slash followed by at least one character) excludes the
        // bundled static docs site while leaving `/docs/` itself — the web
        // app's own landing page — to be locale-prefixed like any other page.
        //
        // The locale alternation MUST stay in its own group: `en|de(?:/|$)`
        // parses as `en` OR `de(?:/|$)`, so a bare `en` swallows every path
        // that merely starts with those letters and a workspace named
        // `england` 404s.
        beforeFiles: [
          { source: "/", destination: `/${DEFAULT_LOCALE}` },
          {
            source: `/:path((?!(?:${LOCALE_ALTERNATION})(?:/|$)|api/|_next/|sitemap/|sitemap\\.xml|robots\\.txt|manifest\\.json|classifyre-cfg|classifyre-usr/|favicon\\.ico|icon0\\.svg|icon1\\.png|apple-icon\\.png|docs/.|[^/]+\\.[a-zA-Z0-9]+$).*)`,
            destination: `/${DEFAULT_LOCALE}/:path`,
          },
        ],
        // `:path+` requires at least one segment, which leaves `/docs` itself
        // to the web app's own documentation landing page
        // (app/[locale]/docs/page.tsx). The bundled documentation site is
        // English-only, so every locale resolves to the same static files.
        afterFiles: [
          { source: "/docs/:path+", destination: "/docs/:path+/index.html" },
          {
            source: `/:locale(${LOCALE_ALTERNATION})/docs/:path+`,
            destination: "/docs/:path+/index.html",
          },
        ],
        fallback: [],
      };
    },
    // The default locale is unprefixed, so its prefixed form is a duplicate
    // URL. Redirect rather than serve both, or every page has two indexable
    // addresses.
    async redirects() {
      return [
        { source: `/${DEFAULT_LOCALE}`, destination: "/", permanent: true },
        {
          source: `/${DEFAULT_LOCALE}/:path*`,
          destination: "/:path*",
          permanent: true,
        },
      ];
  },
};

export default nextConfig;
