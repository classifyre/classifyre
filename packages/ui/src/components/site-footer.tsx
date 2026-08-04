import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "../lib/utils";
import {
  contactEmail,
  demoSiteUrl,
  docsSiteUrl,
  marketingPaths,
  repositoryUrl,
} from "../lib/site-links";
import { softwareVersionLabel } from "../lib/software-version";
import { CookieSettingsButton } from "./cookie-consent-banner";

/**
 * The public footer, shared by the marketing site and the docs site.
 *
 * Both sites render it as the `footer` of a Nextra `<Layout>`, so it is one
 * component rather than two that drift: the same logo lockup, the same
 * navigation as the header, and the same legal strip on both. The band is
 * always black — it is a deliberate hard stop at the bottom of the page, not a
 * themed surface, so it does not flip with light/dark mode.
 *
 * `origin` is the only difference between the two callers. On the marketing
 * site the routes resolve same-origin and it stays empty; the docs site passes
 * `marketingSiteUrl` so the same paths become absolute links back.
 */

type FooterLink = {
  label: string;
  href: string;
  /** Leaves the current site — renders the arrow and opens in a new tab. */
  external?: boolean;
};

function LinkList({ links }: { links: readonly FooterLink[] }) {
  return (
    <ul className="space-y-2.5">
      {links.map((link) => (
        <li key={link.label}>
          <a
            href={link.href}
            {...(link.external
              ? { target: "_blank", rel: "noreferrer" }
              : null)}
            className="group inline-flex items-center gap-1.5 text-[13px] leading-6 text-white/70 transition-colors hover:text-accent"
          >
            <span className="decoration-accent decoration-2 underline-offset-4 group-hover:underline">
              {link.label}
            </span>
            {link.external ? (
              <ArrowUpRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-white/35 transition-all group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-accent"
              />
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ColumnHead({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
        {children}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-white/12" />
    </div>
  );
}

/** Drawn as bars, not an emoji, to match the site's flat, hard-edged language. */
function AustrianFlag() {
  return (
    <span
      aria-hidden="true"
      className="flex h-3 w-[18px] shrink-0 flex-col overflow-hidden border border-white/25"
    >
      <span className="h-1/3 w-full bg-[#ed2939]" />
      <span className="h-1/3 w-full bg-white" />
      <span className="h-1/3 w-full bg-[#ed2939]" />
    </span>
  );
}

export function SiteFooter({
  origin = "",
  logoSrc = "/clasifyre_icon.png",
  className,
}: {
  /** Prefix for marketing routes. Empty on the marketing site itself. */
  origin?: string;
  logoSrc?: string;
  className?: string;
}) {
  const marketing = (path: string) => `${origin}${path}`;

  /* Mirrors the header: the Product menu, Blog, Documentation, and the two
     actions that live as buttons up there (Demo, GitHub). */
  const navigation: readonly FooterLink[] = [
    { label: "Home", href: marketing(marketingPaths.home) },
    { label: "Download & install", href: marketing(marketingPaths.download) },
    { label: "Sources", href: marketing(marketingPaths.sources) },
    {
      label: "Open source vs Enterprise",
      href: marketing(marketingPaths.editions),
    },
    { label: "Blog", href: marketing(marketingPaths.blog) },
    { label: "Documentation", href: `${docsSiteUrl}/`, external: true },
    { label: "Live demo", href: `${demoSiteUrl}/`, external: true },
    { label: "GitHub", href: repositoryUrl, external: true },
  ];

  return (
    <div
      className={cn(
        "w-full border-t-2 border-white/20 bg-black text-white",
        className,
      )}
    >
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-14 lg:px-10 lg:py-16">
        {/* ── Identity ─────────────────────────────────────────────── */}
        <div className="max-w-md">
          <a
            href={marketing(marketingPaths.home)}
            className="inline-flex items-center gap-3"
          >
            <span className="flex aspect-square size-10 items-center justify-center overflow-hidden rounded-lg border-0 ">
              <img
                src={logoSrc}
                width={40}
                height={40}
                alt=""
                className="size-full object-cover"
              />
            </span>
            <span className="grid text-left leading-tight">
              <span className="font-serif text-lg font-bold tracking-[0.04em]">
                Classifyre
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                Investigation Platform
              </span>
            </span>
          </a>

          <p className="mt-6 text-[15px] leading-7 text-white/70">
            The open-source investigation platform for your data. Classifyre
            scans the systems you already run, detects secrets, PII, and the
            signals you define, then works the findings like a detective —
            standing inquiries, ranked evidence, cases, and an AI autopilot
            between scans.
          </p>

          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            Desktop app · Kubernetes · Apache-2.0
          </p>
        </div>

        {/* ── Navigation, mirroring the header ─────────────────────── */}
        <nav aria-label="Footer">
          <ColumnHead>Navigate</ColumnHead>
          <LinkList links={navigation} />
        </nav>

        {/* ── Legal & contact ──────────────────────────────────────── */}
        <div>
          <ColumnHead>Legal &amp; contact</ColumnHead>
          <ul className="space-y-2.5">
            <li>
              <a
                href={marketing(marketingPaths.privacy)}
                className="text-[13px] leading-6 text-white/70 decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent hover:underline"
              >
                Privacy &amp; cookie policy
              </a>
            </li>
            <li>
              {/* Withdrawing consent has to be as easy as giving it —
                  GDPR Art. 7(3) is explicit about that. */}
              <CookieSettingsButton className="text-left text-[13px] leading-6 text-white/70 decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent hover:underline" />
            </li>
            <li>
              <a
                href={`mailto:${contactEmail}`}
                className="text-[13px] leading-6 text-white/70 decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent hover:underline"
              >
                Contact
              </a>
            </li>
            <li className="pt-2">
              <a
                href={marketing(marketingPaths.madeInEurope)}
                className="group inline-flex items-center gap-2.5 border-2 border-white/20 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/70 transition-colors hover:border-accent hover:text-white"
              >
                <AustrianFlag />
                Made in Austria
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* ── Baseline ───────────────────────────────────────────────── */}
      <div className="border-t-2 border-white/20">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <span>
            © {new Date().getFullYear()} Classifyre · Apache-2.0 · v
            {softwareVersionLabel}
          </span>
          <span className="text-white/35">Every leak leaves a trail</span>
        </div>
      </div>
    </div>
  );
}
