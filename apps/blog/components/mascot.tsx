import { cn } from "@workspace/ui/lib/utils";

/**
 * The hand-inked investigator drawings (delivered by the designer as black
 * ink on transparency).
 *
 * The ink is the whole image, so the theme flip is one CSS filter: `invert`
 * turns the black ink white while the transparency stays untouched, and no
 * background is ever painted; the page's own surface shows through, exactly
 * the way the drawings sit on paper.
 *
 *   surface="page"  → section follows the theme: black ink in light mode,
 *                     white ink under `dark:`
 *   surface="dark"  → section is a black band in both themes (hero,
 *                     conversion): white ink always
 *
 * The sloppy brush edges are the style; never clean these up.
 */

export type MascotName =
  | "hidden-gem"
  | "looking-around"
  | "looking-at-you"
  | "questioning";

/** Intrinsic sizes, so the browser reserves the box before decode. */
const DIMENSIONS: Record<MascotName, { width: number; height: number }> = {
  "hidden-gem": { width: 459, height: 760 },
  "looking-around": { width: 419, height: 760 },
  "looking-at-you": { width: 417, height: 760 },
  questioning: { width: 430, height: 760 },
};

const TILT = {
  left: "-rotate-[3deg]",
  right: "rotate-[3deg]",
  none: "",
} as const;

export function Mascot({
  name,
  alt,
  surface = "page",
  tilt = "none",
  eager = false,
  className,
}: {
  name: MascotName;
  /** Describe the pose; these drawings carry meaning, not decoration. */
  alt: string;
  surface?: "page" | "dark";
  tilt?: keyof typeof TILT;
  /** Above-the-fold placements only. */
  eager?: boolean;
  className?: string;
}) {
  const size = DIMENSIONS[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/marketing/mascot/${name}.webp`}
      alt={alt}
      width={size.width}
      height={size.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn(
        "select-none",
        surface === "dark" ? "invert" : "dark:invert",
        TILT[tilt],
        className,
      )}
    />
  );
}
