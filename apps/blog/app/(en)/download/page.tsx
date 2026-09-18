import type { Metadata } from "next";

import { routes } from "@/lib/site";

/**
 * `/download` moved to `/get` when the desktop app was replaced by a single
 * Docker image — there is nothing to download any more.
 *
 * This page exists because neither redirects nor rewrites are available to us:
 * both this site and the docs site are `output: "export"`, so `next.config.mjs`
 * cannot express a redirect, and there is no hosting-layer rule in the repo to
 * put one in. A meta refresh plus a `location.replace` is what a static host
 * can actually honour.
 *
 * It is not only for old bookmarks. Every already-shipped copy of the app has
 * the absolute `/download/` URL compiled into its demo-mode upgrade dialog
 * (packages/ui/src/lib/site-links.ts), so this is the landing point for
 * instances in the wild that will never be rebuilt.
 */

const TARGET = `${routes.get}/`;

export const metadata: Metadata = {
  title: "Moved to /get",
  alternates: { canonical: TARGET },
  // Keep it out of the index: the destination is the page that should rank.
  robots: { index: false, follow: true },
};

export default function DownloadRedirectPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-24 sm:px-6">
      {/* Hoisted into <head> by React. Written here rather than through the
          metadata API because that one can only emit <meta name="...">, and a
          refresh only works as http-equiv. This is the no-JS path. */}
      <meta httpEquiv="refresh" content={`0; url=${TARGET}`} />
      {/* And this is the fast path, before paint, for everyone else. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(TARGET)});`,
        }}
      />
      <h1 className="font-serif text-2xl font-black uppercase tracking-[0.04em]">
        This page moved
      </h1>
      <p className="text-base leading-7 text-muted-foreground">
        Classifyre is now a single Docker image rather than a desktop download.
        You are being sent to{" "}
        <a href={TARGET} className="underline underline-offset-4">
          Get Classifyre
        </a>
        .
      </p>
    </main>
  );
}
