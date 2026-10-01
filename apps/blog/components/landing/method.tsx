"use client";

import * as React from "react";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { Mascot } from "@/components/mascot";
import {
  LandingHead,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * The method: five moves along one evidence thread, told as a zigzag
 * timeline. The thread runs down the middle and fills as the reader
 * scrolls; the stage slips alternate sides of it, and the investigator
 * keeps a light parallax drift. Nothing dims and nothing pops in: the
 * content is readable the moment it renders, the motion is only the thread
 * and the mascot. Falls back to plain, fully visible stages without JS and
 * under reduced motion.
 */

export function Method({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const fillRef = React.useRef<SVGLineElement | null>(null);
  const mascotRef = React.useRef<HTMLDivElement | null>(null);

  /* The thread draws with the scroll; the mascot keeps a light parallax. */
  React.useEffect(() => {
    const list = listRef.current;
    const fill = fillRef.current;
    const mascot = mascotRef.current;
    if (!list || !fill) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = list.getBoundingClientRect();
      const anchor = window.innerHeight * 0.65;
      const progress = Math.min(
        1,
        Math.max(0, (anchor - rect.top) / Math.max(rect.height, 1)),
      );
      fill.style.strokeDashoffset = String(1 - progress);
      if (mascot && !reduced) {
        mascot.style.transform = `translateY(${(progress - 0.5) * -28}px)`;
      }
    };

    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
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
      aria-labelledby="method-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <LandingHead
          id="method-title"
          mark={copy.method.marker}
          title={copy.method.title}
          lede={copy.method.lede}
          tone="dark"
          aside={
            <div
              ref={mascotRef}
              className="hidden will-change-transform lg:block"
            >
              <Mascot
                name="looking-around"
                alt={copy.mascots.lookingAround}
                surface="dark"
                className="h-44 w-auto"
              />
            </div>
          }
        />

        <ol ref={listRef} className="relative mt-16">
          {/* The thread down the middle, filling as the reader scrolls. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 2 100"
            preserveAspectRatio="none"
            className="absolute bottom-0 left-1/2 top-0 hidden w-2 -translate-x-1/2 lg:block"
          >
            <line
              x1="1"
              y1="0"
              x2="1"
              y2="100"
              stroke="#b7ff00"
              strokeOpacity="0.18"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <line
              ref={fillRef}
              x1="1"
              y1="0"
              x2="1"
              y2="100"
              stroke="#b7ff00"
              strokeOpacity="0.8"
              strokeWidth="2"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset="0"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {copy.method.stages.map((stage, index) => {
            const left = index % 2 === 0;
            return (
              <li
                key={stage.no}
                className="relative pb-10 lg:grid lg:grid-cols-2 lg:gap-24 lg:pb-14"
              >
                {/* The pin, planted on the thread */}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-10 hidden -translate-x-1/2 lg:block"
                >
                  <Pin className="size-3.5 bg-black" />
                </span>

                <div
                  className={
                    left
                      ? "lg:col-start-1 lg:justify-self-end"
                      : "lg:col-start-2 lg:justify-self-start"
                  }
                >
                  <article className="max-w-md border-2 border-white/15 bg-white/[0.04] p-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-hero text-4xl leading-none text-accent">
                        {stage.no}
                      </span>
                      <Micro className="text-white/45">{stage.word}</Micro>
                    </div>
                    <h3 className="mt-4 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {stage.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-white/65">
                      {stage.body}
                    </p>
                    <a
                      href={stage.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                    >
                      {stage.linkLabel} →
                    </a>
                  </article>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
