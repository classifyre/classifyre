import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundPage } from "nextra-theme-docs";

/**
 * 404 inside the docs shell. `<NotFoundPage>` keeps the theme chrome and adds
 * the "report a broken link" issue link, prefilled against
 * `docsRepositoryBase` — the sections below are the ones a reader who landed
 * on a dead URL most often wanted.
 */

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const DESTINATIONS: Array<{ name: string; blurb: string; href: string }> = [
  {
    name: "Install Classifyre",
    blurb: "The desktop app, or the Helm chart on Kubernetes.",
    href: "/deployment/",
  },
  {
    name: "How it works",
    blurb: "The whole platform in plain English, section by section.",
    href: "/how-it-works/",
  },
  {
    name: "Sources",
    blurb: "Every system you can connect, and how to configure it.",
    href: "/sources/",
  },
  {
    name: "Detectors",
    blurb: "Pre-built packs and custom detectors, from regex to full AI.",
    href: "/detectors/",
  },
];

export default function NotFound() {
  return (
    <NotFoundPage
      content="Report this broken link"
      labels="broken-link"
      // The issue link is the container's only direct <a>; the cards below
      // bring their own styling.
      className="px-6 text-center [&>a]:font-mono [&>a]:text-[13px] [&>a]:font-bold [&>a]:uppercase [&>a]:tracking-[0.14em] [&>a]:text-foreground [&>a]:decoration-accent [&>a]:decoration-2 [&>a]:underline-offset-4"
    >
      <h1
        className="text-6xl uppercase leading-[0.9] sm:text-7xl"
        style={{ fontFamily: "var(--font-hero)" }}
      >
        404 — no such page
      </h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
        This URL does not exist in the documentation. It may have moved with a
        release, or the link that brought you here may be wrong. Search from the
        bar above, or start somewhere concrete:
      </p>

      <div className="not-prose mx-auto mt-8 grid max-w-3xl grid-cols-1 border-t-2 border-l-2 border-border text-left sm:grid-cols-2">
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.href}
            href={destination.href}
            className="group flex flex-col gap-1.5 border-r-2 border-b-2 border-border p-4 transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="font-serif text-base font-black uppercase tracking-[0.05em]">
              {destination.name}
            </span>
            <span className="text-xs leading-5 text-muted-foreground group-hover:text-accent-foreground">
              {destination.blurb}
            </span>
          </Link>
        ))}
      </div>
    </NotFoundPage>
  );
}
