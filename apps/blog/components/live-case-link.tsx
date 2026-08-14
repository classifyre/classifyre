"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@workspace/ui/lib/utils";

type LiveCaseLinkProps = {
  href: string;
  caseName: string;
};

function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b7ff00] opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-[#b7ff00]" />
    </span>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="square"
      className={cn("size-3.5", className)}
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

/**
 * Every case-file post links out to its live, inspectable Classifyre
 * namespace. This renders that link twice from one real <a> each: an
 * always-visible slab under the hero, and a compact pill that takes over
 * once the slab scrolls out of view — so the link stays reachable for the
 * whole 20+ minute read without ever leaving the DOM (crawlable + no-JS-safe).
 */
export function LiveCaseLink({ href, caseName }: LiveCaseLinkProps) {
  const [slabVisible, setSlabVisible] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setSlabVisible(entry.isIntersecting);
      },
      { rootMargin: "-88px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ariaLabel = `Open the live ${caseName} case file in the Classifyre demo (opens in a new tab)`;

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className="group -rotate-[0.6deg] mb-8 flex flex-col gap-3 border-2 border-border bg-[#b7ff00] px-5 py-4 text-black shadow-[5px_5px_0_0_var(--color-border)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[7px_7px_0_0_var(--color-border)] sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <span className="flex items-center gap-3">
          <LiveDot />
          <span className="flex flex-col">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black/70">
              Live namespace &middot; updates as scans run
            </span>
            <span className="font-serif text-lg font-black uppercase tracking-[0.02em] sm:text-xl">
              Inspect the {caseName} case file
            </span>
          </span>
        </span>

        <span className="inline-flex shrink-0 items-center gap-2 self-start border-2 border-black bg-black px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#b7ff00] sm:self-auto">
          Open Case
          <ArrowIcon className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </a>

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        aria-hidden={slabVisible}
        tabIndex={slabVisible ? -1 : 0}
        className={cn(
          "group fixed bottom-5 right-5 z-40 flex items-center gap-2.5 border-2 border-black bg-[#b7ff00] py-2.5 pl-3 pr-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_0_#000] transition-all duration-300 ease-out sm:bottom-8 sm:right-8",
          slabVisible
            ? "pointer-events-none translate-y-3 opacity-0"
            : "translate-y-0 opacity-100 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#000]",
        )}
      >
        <LiveDot />
        Open live case
        <ArrowIcon />
      </a>
    </>
  );
}
