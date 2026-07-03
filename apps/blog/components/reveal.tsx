"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Wraps children in a container that fades/slides in once it enters the
 * viewport. Animation lives in landing.css (`.cl-reveal`); this component
 * only toggles the `data-inview` attribute so it stays cheap and SSR-safe.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
  as?: "div" | "section" | "figure" | "li";
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={cn("cl-reveal", className)}
      data-inview={inView ? "true" : "false"}
      style={{ "--cl-delay": `${delayMs}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
