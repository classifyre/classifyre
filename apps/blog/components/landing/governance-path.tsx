"use client";

import * as React from "react";
import {
  BarChart3,
  Database,
  EyeOff,
  FileSearch,
  GitMerge,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { Micro } from "@/components/landing/motifs";

/**
 * The six-stage end-to-end governance flow:
 * Integrate → Detect → Govern → Mask → Query & BI → Request & Share.
 */

const ICONS: readonly LucideIcon[] = [
  Database,
  FileSearch,
  Users,
  EyeOff,
  BarChart3,
  GitMerge,
];

const BEAT_MS = 1200;

export function GovernancePath({ locale }: { locale: Locale }) {
  const steps = getLandingCopy(locale).path.steps;
  const [beat, setBeat] = React.useState(-1);
  const [moving, setMoving] = React.useState(false);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setMoving(true);
    const id = window.setInterval(() => setBeat((b) => b + 1), BEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  const active = beat < 0 ? -1 : beat % steps.length;
  const lap = beat < 0 ? 0 : Math.floor(beat / steps.length);

  return (
    <ol
      aria-label={getLandingCopy(locale).path.label}
      className="relative grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-3"
    >
      {/* The connecting line and pulse (wide screens). */}
      <span
        aria-hidden="true"
        className="cl-path-line absolute left-[8%] right-[8%] top-[18px] hidden lg:block"
      />
      {moving ? (
        <span
          aria-hidden="true"
          className="cl-path-pulse absolute top-[15px] hidden lg:block"
          style={{ "--cl-dur": `${(BEAT_MS * steps.length) / 1000}s` } as React.CSSProperties}
        />
      ) : null}

      {steps.map((step, index) => {
        const Icon = ICONS[index] ?? Database;
        const lit = index === active;
        const example = step.examples[(lap + index) % step.examples.length] ?? "";
        return (
          <li key={step.verb} className="relative flex flex-col items-start lg:items-center lg:text-center">
            <span
              className={cn(
                "relative z-10 flex size-9 items-center justify-center border-2 transition-colors duration-300",
                lit
                  ? "border-accent bg-accent text-black"
                  : "border-accent/60 bg-black text-accent",
              )}
            >
              <Icon className="size-4" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <Micro
              className={cn(
                "mt-3 transition-colors duration-300",
                lit ? "text-accent" : "text-white/85",
              )}
            >
              {step.verb}
            </Micro>
            <span
              key={example}
              className="cl-tag-swap mt-1 block font-mono text-[11px] leading-4 text-white/60"
            >
              {example}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
