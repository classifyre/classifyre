import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { cn } from "@workspace/ui/lib/utils";
import { fontVariables } from "./fonts";

export type Theme = "dark" | "light";

interface StageProps {
  theme?: Theme;
  /** The acid-green landing-page grid behind the content. */
  grid?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * The frame every scene sits in: product theme, product fonts, product ground.
 *
 * The theme class goes on an outer element and the surface on an inner one
 * because `dark:` is declared as `&:is(.dark *)` — it matches descendants of
 * `.dark`, never the element carrying the class.
 */
export function Stage({
  theme = "dark",
  grid = false,
  className,
  style,
  children,
}: StageProps) {
  return (
    <AbsoluteFill
      className={theme === "dark" ? "dark" : undefined}
      style={{ ...fontVariables, ...style }}
    >
      <AbsoluteFill
        className={cn(
          "bg-background font-sans text-foreground antialiased",
          className,
        )}
      >
        {grid && <AbsoluteFill className="landing-grid" />}
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

interface ViewportProps {
  /** How much larger than life the UI is drawn. 2 gives a 960x540 window on a 1080p frame. */
  scale?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Product components are sized for a browser, where 12px type is readable; on
 * a 1080p frame it is not. This lays its children out in a window `scale`
 * times smaller than the frame and magnifies the result, so real components
 * fill the picture without a single size being overridden.
 */
export function Viewport({ scale = 2, className, children }: ViewportProps) {
  const { width, height } = useVideoConfig();

  return (
    <div
      className={className}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: width / scale,
        height: height / scale,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      {children}
    </div>
  );
}
