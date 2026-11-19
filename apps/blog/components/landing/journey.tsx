"use client";

import * as React from "react";
import {
  BarChart3,
  Database,
  EyeOff,
  GitMerge,
  type LucideIcon,
  ShieldCheck,
  Table2,
} from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { Demo, type DemoId } from "@/components/demos";
import { LandingHead, Micro } from "@/components/landing/motifs";
import { ReadersPanel } from "@/components/landing/readers-panel";
import { Mascot } from "@/components/mascot";

/**
 * How it works, as one thread running down the page.
 *
 * Six stations, in the order data actually moves through Classifyre:
 * connect and detect, query across sources, govern, connect a BI tool, mask
 * per person, share a dataset. The thread fills as the reader scrolls and a
 * lime pulse rides its tip; each station's node lights up when the thread
 * reaches it, the way the hero's path band lights its stations in turn.
 *
 * Every station is readable on its own: a plain-language explanation (this
 * is the text search engines and buyers read), a few facts, a link into the
 * docs, and next to it the thing itself, playing on its own: the scan, the
 * query typed and run, the table being governed, the Power BI connection,
 * the two readers, the dataset being shared.
 */

const ICONS: Record<string, LucideIcon> = {
  discover: Database,
  query: Table2,
  govern: ShieldCheck,
  bi: BarChart3,
  mask: EyeOff,
  share: GitMerge,
};

export function Journey({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const j = copy.journey;
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const fillRef = React.useRef<HTMLSpanElement | null>(null);
  const nodeRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const [lit, setLit] = React.useState(0);

  React.useEffect(() => {
    const list = listRef.current;
    const fill = fillRef.current;
    if (!list || !fill) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = list.getBoundingClientRect();
      const anchor = window.innerHeight * 0.6;
      const reach = Math.min(rect.height, Math.max(0, anchor - rect.top));
      fill.style.height = `${reach}px`;
      let count = 0;
      for (const node of nodeRefs.current) {
        if (node && node.getBoundingClientRect().top + 18 <= anchor) count += 1;
      }
      setLit(count);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section
      id="how-it-works"
      aria-labelledby="journey-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <div className="landing-grid absolute inset-0 opacity-[0.08]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <LandingHead
          id="journey-title"
          mark={j.marker}
          title={j.title}
          lede={j.lede}
          tone="dark"
          aside={
            <Mascot
              name="looking-around"
              alt={copy.mascots.lookingAround}
              surface="dark"
              className="hidden h-44 w-auto lg:block"
            />
          }
        />

        <ol ref={listRef} className="relative mt-16">
          {/* The thread, and its filled part with the pulse at the tip. */}
          <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-0 w-0.5 bg-accent/15" />
          <span
            ref={fillRef}
            aria-hidden="true"
            className="cl-thread-fill absolute left-[17px] top-0 w-0.5 bg-accent/80"
            style={{ height: 0 }}
          />

          {j.stages.map((stage, index) => {
            const Icon = ICONS[stage.id] ?? Database;
            const on = index < lit;
            return (
              <li key={stage.id} id={`how-${stage.id}`} className="relative pb-20 pl-14 last:pb-0 lg:pb-28">
                <span
                  ref={(node) => {
                    nodeRefs.current[index] = node;
                  }}
                  aria-hidden="true"
                  className={cn(
                    "absolute left-0 top-0 flex size-9 items-center justify-center border-2 transition-colors duration-500",
                    on ? "border-accent bg-accent text-black" : "border-accent/50 bg-black text-accent",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2.2} />
                </span>

                <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
                  <div className="min-w-0 lg:col-span-5">
                    <div className="flex items-baseline gap-3">
                      <span className="font-hero text-4xl leading-none text-accent">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Micro className={on ? "text-accent" : "text-white/60"}>{stage.step}</Micro>
                    </div>
                    <h3 className="mt-4 font-serif text-xl font-black uppercase leading-tight tracking-[0.04em]">
                      {stage.title}
                    </h3>
                    {stage.body.map((paragraph) => (
                      <p key={paragraph.slice(0, 24)} className="mt-4 text-sm leading-7 text-white/70 sm:text-base sm:leading-8">
                        {paragraph}
                      </p>
                    ))}
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {stage.facts.map((fact) => (
                        <li key={fact} className="border-2 border-white/15 px-2 py-1">
                          <Micro className="text-white/75">{fact}</Micro>
                        </li>
                      ))}
                    </ul>
                    <a
                      href={stage.href}
                      className="mt-5 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                    >
                      {stage.linkLabel} →
                    </a>
                  </div>

                  <div className="min-w-0 lg:col-span-7">
                    <StageMedia locale={locale} media={stage.media} caption={stage.caption} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function StageMedia({
  locale,
  media,
  caption,
}: {
  locale: Locale;
  media: string;
  caption: string;
}) {
  if (media === "readers") return <ReadersPanel locale={locale} />;
  return <Demo id={media as DemoId} locale={locale} caption={caption} />;
}
