import type { CSSProperties, ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

/*
 * The words a video sets itself, outside the product: title cards, questions,
 * the closing line. The same three things the landing page is lettered with:
 * a lime chip in mono capitals, a headline in League Gothic, and one word of
 * it marked in lime.
 */

interface Lettered {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** The lime label a title card opens with: "CASE FILE · YOUR LAPTOP". */
export function Chip({ className, style, children }: Lettered) {
  return (
    <p
      className={cn(
        "inline-block bg-accent px-4 py-2 font-mono text-[21px] font-bold uppercase tracking-[0.22em] text-black",
        className,
      )}
      style={style}
    >
      {children}
    </p>
  );
}

/**
 * Poster type. Give each line its own block-level child and wrap the word
 * that matters in `Mark`. `size` is the type size in pixels: about 200 for a
 * title of two short lines, 140 where something else shares the picture.
 */
export function Headline({
  size = 200,
  className,
  style,
  children,
}: Lettered & { size?: number }) {
  return (
    <h2
      className={cn(
        "uppercase leading-[0.87] tracking-[0.01em] text-white",
        className,
      )}
      style={{ fontFamily: "var(--font-hero)", fontSize: size, ...style }}
    >
      {children}
    </h2>
  );
}

/** The word a headline is about, on lime. One a headline. */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block bg-accent px-[0.12em] text-black">
      {children}
    </span>
  );
}
