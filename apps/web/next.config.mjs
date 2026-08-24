import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isDesktopBuild ? "export" : "standalone",
  trailingSlash: true,
  ...(!isDesktopBuild && {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  }),
  transpilePackages: ["@workspace/ui"],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === "1",
  },
  ...(!isDesktopBuild && {
    allowedDevOrigins: ["127.0.0.1", "localhost", "classifyre.localhost"],
    // The documentation site (apps/docs) is a static export copied into
    // `public/docs` by `bun run docs:bundle`, so every page of it is a
    // directory holding an `index.html`. Next's public-file handler only serves
    // *exact* paths — `/docs/how-it-works/index.html` resolves, `/docs/how-it-works/`
    // does not — so on the server deployments (Kubernetes, `next start`) the
    // whole bundled site 404s. The desktop build does not need this: its
    // `app://` protocol handler already resolves a directory to its index.html,
    // and `output: "export"` rejects rewrites outright.
    //
    // `afterFiles` (not `beforeFiles`) is what makes this safe: it runs only
    // once the filesystem has failed to match, so real files — the docs site's
    // own `_next` chunks, `_pagefind` search index, images — are still served
    // directly and never get an `/index.html` glued onto them.
    async rewrites() {
      return {
        beforeFiles: [],
        // `:path+` requires at least one segment, which leaves `/docs` itself
        // to the web app's own documentation landing page (app/docs/page.tsx).
        afterFiles: [
          { source: "/docs/:path+", destination: "/docs/:path+/index.html" },
        ],
        fallback: [],
      };
    },
  }),
  ...(isDesktopBuild && {
    images: { unoptimized: true },
  }),
};

export default nextConfig;
