import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { PageHero, SectionHead, SectionShell } from "@/components/page-kit";
import { demoUrl, docs, routes } from "@/lib/site";

import "./landing.css";

/**
 * Marketing 404. Same masthead as every other sub-page, so a dead link still
 * lands somewhere that looks like the site, with the four routes people
 * actually arrive looking for.
 */

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const DESTINATIONS: Array<{
  title: string;
  body: string;
  href: string;
  external?: boolean;
}> = [
  {
    title: "Download & install",
    body: "The desktop app for macOS, Windows, and Linux, or the Helm chart for Kubernetes.",
    href: routes.download,
  },
  {
    title: "Documentation",
    body: "How the platform works, section by section — sources, detectors, scans, investigations.",
    href: docs.root,
    external: true,
  },
  {
    title: "Supported sources",
    body: "Every system Classifyre can read, from databases and lakehouses to collaboration tools.",
    href: routes.sources,
  },
  {
    title: "Writing",
    body: "Notes on detection, investigation, and running this thing in the real world.",
    href: routes.blog,
  },
];

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="404"
        title={
          <>
            That page
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              left no trail.
            </span>
          </>
        }
        lede="The URL does not exist — or it did, and moved with a release. Here is where everyone else was going."
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={routes.home}>Back to the home page</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={demoUrl} target="_blank" rel="noreferrer">
                Try the live demo
              </a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="not-found-links">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="not-found-links"
              marker="Try these"
              title="Four doors that are definitely open"
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {DESTINATIONS.map((destination) => (
                <a
                  key={destination.href}
                  href={destination.href}
                  {...(destination.external
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                  className="flex h-full flex-col gap-2 border-2 border-border bg-background p-5 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-[4px_4px_0_var(--color-accent)]"
                >
                  <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                    {destination.title}
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {destination.body}
                  </p>
                </a>
              ))}
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
