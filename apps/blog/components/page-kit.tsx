import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { Illustration, type IllustrationName } from "@/components/illustration";

/**
 * The shared chrome of the marketing site: the section shell, the accent
 * marker chip, the headline block, and the docs button. Extracted out of the
 * landing page once /download, /sources, and /open-source-vs-enterprise
 * started needing the same case-file visual language.
 *
 * `tone="signal"` paints a section with `bg-foreground`, which *flips* with
 * the theme — near-black in light mode, near-white in dark. Anything placed
 * on it has to flip too; see `surface="inverted"` on Illustration and the
 * `dark:text-accent-foreground` pairs below.
 */

export type SectionTone = "signal" | "plain";

export function Marker({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border-2 border-accent bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black">
      {label}
    </span>
  );
}

export function SectionShell({
  tone = "plain",
  fullWidth = false,
  children,
  className = "",
}: {
  tone?: SectionTone;
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative",
        // overflow-hidden creates a scroll container and would break any
        // position:sticky descendant, so only the tinted sections (which
        // need it to clip the grid overlay) get it.
        tone === "signal" && "overflow-hidden",
        // Full-bleed sections break out of `main`'s max width — see
        // `.cl-bleed` in landing.css for why this isn't plain `w-screen`.
        fullWidth
          ? "cl-bleed rounded-none border-0"
          : "rounded-[8px] border-2 border-border",
        tone === "signal"
          ? "bg-foreground text-primary-foreground"
          : "bg-background text-foreground",
        className,
      )}
    >
      {tone === "signal" ? (
        <div className="landing-grid absolute inset-0 opacity-30" />
      ) : null}
      <div
        className={cn(
          "relative py-10 sm:py-12 lg:py-16",
          fullWidth ? "px-4 sm:px-6 lg:px-10" : "px-6 sm:px-8 lg:px-10",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Section headline block: marker, title, at most two lines of copy. */
export function SectionHead({
  id,
  marker,
  title,
  lede,
  tone = "plain",
  action,
  illustration,
}: {
  id: string;
  marker?: string;
  title: ReactNode;
  lede?: string;
  tone?: SectionTone;
  action?: ReactNode;
  illustration?: IllustrationName;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-6 lg:gap-8">
        {illustration ? (
          // Hung level with the headline and sized as a drawing, not a bullet.
          <Illustration
            name={illustration}
            surface={tone === "signal" ? "inverted" : "page"}
            tilt="left"
            className="-mt-2 hidden h-28 w-28 shrink-0 sm:block lg:h-36 lg:w-36"
          />
        ) : null}
        <div className="space-y-3">
          {marker && <Marker label={marker} /> }
          <h2
            id={id}
            className="font-serif text-[clamp(2rem,5vw,3rem)] font-black uppercase leading-[0.92] tracking-[0.04em]"
          >
            {title}
          </h2>
          {lede ? (
            <p
              className={cn(
                "max-w-2xl text-base leading-7",
                tone === "signal"
                  ? "text-primary-foreground/72"
                  : "text-muted-foreground",
              )}
            >
              {lede}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function DocsLink({
  href,
  children,
  tone = "plain",
}: {
  href: string;
  children: ReactNode;
  tone?: SectionTone;
}) {
  return (
    <Button
      asChild
      variant="secondary"
      className={cn(
        "border-2",
        tone === "signal"
          ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/16"
          : "border-border",
      )}
    >
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    </Button>
  );
}

/**
 * Sub-page masthead. Always black in both themes, like the landing hero, so
 * the site reads as one publication rather than four separate pages.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  actions,
  aside,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title">
      <SectionShell tone="signal" fullWidth className="bg-black">
        <div className="flex flex-col gap-10 text-white lg:flex-row lg:items-center lg:gap-14">
          <div className="space-y-6 lg:flex-[1.3]">
            {eyebrow && <Marker label={eyebrow} />}
            <h1
              id="page-title"
              className="font-hero text-[clamp(3rem,9vw,6.5rem)] font-normal uppercase leading-[0.88] tracking-[0.01em] text-white"
            >
              {title}
            </h1>
            {lede && <div className="max-w-2xl text-lg leading-8 text-white/78">
              {lede}
            </div> }
            {actions ? (
              <div className="flex flex-wrap items-center gap-3">{actions}</div>
            ) : null}
          </div>
          {aside ? <div className="lg:flex-1">{aside}</div> : null}
        </div>
      </SectionShell>
    </section>
  );
}
