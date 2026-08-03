import { cn } from "@workspace/ui/lib/utils";

/**
 * Hand-inked illustrations (the same set the docs site uses).
 *
 * These are drawings, not icons — they carry the page's voice, so they are
 * sized as artwork (roughly 80–160px) and hung slightly off-square, the way
 * you'd pin a sketch to a board. Anything smaller loses the brush texture and
 * the lime wash that make them worth having.
 *
 * Each drawing ships in two inks: `ink` is drawn in black for light surfaces,
 * `chalk` in white for dark ones. Nothing here is theme-aware at runtime — the
 * caller says which surface the drawing sits on:
 *
 *   surface="page"     → the section's background follows the theme
 *                        (bg-background): black ink in light, white in dark
 *   surface="inverted" → the section is a "signal" panel painted with
 *                        bg-foreground, which flips with the theme — dark in
 *                        light mode, light in dark mode. So this one takes
 *                        the opposite ink of `page`.
 *
 * Rendering both images and hiding one with CSS keeps static export honest:
 * no hydration flash, no client JS.
 */

/**
 * Only the drawings this page actually uses are copied into `public/marketing`
 * — the full set lives in `apps/docs/public/icons/{dark,white}_active`. Adding
 * a name here means copying both inks across too.
 */
export type IllustrationName =
  | "binders"
  | "brush"
  | "check-list"
  | "dna"
  | "docs"
  | "finger-print"
  | "people"
  | "probe"
  | "settings";

type IllustrationProps = {
  name: IllustrationName;
  /** Decorative by default; pass a description when the drawing carries meaning. */
  alt?: string;
  surface?: "page" | "inverted";
  /**
   * Hand-placed tilt. Each drawing gets a different angle so a row of them
   * never reads as a tidy icon strip.
   */
  tilt?: "left" | "right" | "none";
  /** Defaults to 96px — override for feature placements, never downward to icon size. */
  className?: string;
};

const TILT = {
  left: "-rotate-[4deg]",
  right: "rotate-[3.5deg]",
  none: "",
} as const;

export function Illustration({
  name,
  alt = "",
  surface = "page",
  tilt = "none",
  className,
}: IllustrationProps) {
  // Which ink wins in light mode; the other one takes over under `dark:`.
  const [light, dark] =
    surface === "page"
      ? (["ink", "chalk"] as const)
      : (["chalk", "ink"] as const);

  // The wrapper owns sizing and any responsive display the caller asks for;
  // the theme swap lives strictly on the images. Keeping them on separate
  // elements matters — a caller passing `hidden sm:block` would otherwise
  // out-specify `dark:hidden` and paint both inks at once.
  return (
    <span
      className={cn(
        "inline-block h-24 w-24 shrink-0 select-none",
        TILT[tilt],
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/marketing/${light}/${name}.png`}
        alt={alt}
        width={256}
        height={256}
        className="h-full w-full object-contain dark:hidden"
        loading="lazy"
        decoding="async"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/marketing/${dark}/${name}.png`}
        alt=""
        aria-hidden="true"
        width={256}
        height={256}
        className="hidden h-full w-full object-contain dark:block"
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
