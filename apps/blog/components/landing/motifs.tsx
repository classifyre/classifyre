import type { CSSProperties, ReactNode } from "react";

import { cn } from "@workspace/ui/lib/utils";

import { Reveal } from "@/components/reveal";

/**
 * The brand primitives of the case-dossier language. Everything on the
 * landing page is assembled from these so the page reads as one designed
 * document rather than a pile of components:
 *
 *   · mono microtype in uppercase with wide tracking: the annotator's voice;
 *   · dot leaders and exhibit pins: the paper index and the string board;
 *   · a display headline in League Gothic: the poster voice.
 */

/* ── Microtype ──────────────────────────────────────────────────────────── */

/** The annotator's voice: mono, uppercase, wide-tracked microtype. */
export function Micro({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "p" | "figcaption" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "font-mono text-[10px] font-bold uppercase tracking-[0.22em]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Lime stamp chip: one per section, naming the exhibit. */
export function ExhibitMark({
  children,
  tone = "accent",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "outline" | "outline-light";
  className?: string;
}) {
  return (
    <Micro
      className={cn(
        "inline-flex items-center border-2 px-2.5 py-1",
        tone === "accent" && "border-accent bg-accent text-accent-foreground",
        tone === "outline" && "border-foreground/30 text-foreground/70",
        tone === "outline-light" && "border-white/25 text-white/65",
        className,
      )}
    >
      {children}
    </Micro>
  );
}

/** A slammed-on rubber stamp: decorative, rotated, once per page ideally. */
export function Stamp({
  children,
  className,
  delayMs = 600,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "cl-stamp pointer-events-none select-none border-[3px] border-accent px-2.5 py-1 font-mono text-[11px] font-black uppercase tracking-[0.24em] text-accent",
        className,
      )}
      style={{ "--cl-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </span>
  );
}

/* ── Structure ──────────────────────────────────────────────────────────── */

/** Exhibit pin: the knot where threads meet. */
export function Pin({
  solid = true,
  className,
}: {
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("cl-pin", solid && "cl-pin-solid", className)}
    />
  );
}

/** A paper index row: label · dot-leader · value. */
export function DotRow({
  label,
  value,
  className,
  tone = "muted",
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  tone?: "muted" | "light";
}) {
  return (
    <div
      className={cn(
        "flex w-full items-end gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em]",
        tone === "light" ? "text-white/55" : "text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0">{label}</span>
      <span className="cl-dots" aria-hidden="true" />
      <span className="shrink-0">{value}</span>
    </div>
  );
}

/** A thread rule: the evidence thread crossing a section break, with a pin. */
export function ThreadRule({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex items-center gap-3 text-muted-foreground", className)}
    >
      <span className="h-0.5 flex-1 bg-accent/70" />
      <Pin />
      {label ? (
        <Micro className="text-muted-foreground/80">{label}</Micro>
      ) : null}
      <span className="h-0.5 flex-1 bg-accent/70" />
    </div>
  );
}

/**
 * Section headline: exhibit mark, display title, at most two lines of copy.
 * The display face is the poster voice of the page; every H2 gets it.
 */
export function LandingHead({
  id,
  mark,
  title,
  lede,
  tone = "light",
  aside,
}: {
  id: string;
  mark: string;
  title: ReactNode;
  lede?: string;
  /** "light" = theme background, "dark" = black band. */
  tone?: "light" | "dark";
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl space-y-5">
        <ExhibitMark tone={tone === "dark" ? "outline-light" : "outline"}>
          {mark}
        </ExhibitMark>
        <h2
          id={id}
          className={cn(
            "font-hero text-[clamp(2.4rem,5.6vw,4.4rem)] uppercase leading-[0.92] tracking-[0.01em]",
            tone === "dark" ? "text-white" : "text-foreground",
          )}
        >
          {title}
        </h2>
        {lede ? (
          <p
            className={cn(
              "max-w-2xl text-base leading-7 sm:text-lg sm:leading-8",
              tone === "dark" ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {lede}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** Standard section frame with the page's vertical rhythm. */
export function LandingSection({
  children,
  id,
  className,
  width = "wide",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  /** "wide" = full container, "column" = the narrow reading measure. */
  width?: "wide" | "column";
}) {
  return (
    <section id={id} aria-labelledby={id} className={cn("relative", className)}>
      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6 lg:px-10",
          width === "wide" ? "max-w-7xl" : "max-w-5xl",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Reveal wrapper with the section rhythm defaults. */
export function Enter({
  children,
  className,
  delayMs = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  as?: "div" | "section" | "figure" | "li";
}) {
  return (
    <Reveal className={className} delayMs={delayMs} as={as}>
      {children}
    </Reveal>
  );
}
