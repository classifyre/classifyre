/**
 * The one colour vocabulary every status pill in the product draws from.
 *
 * Before this there were six: the case badge and the runner badge each had
 * their own near-identical map, the assets table passed raw `Badge` variants
 * (so an asset's status rendered as the acid-green *default* badge, complete
 * with a hard black drop shadow), the runner-assets table computed inline
 * styles from `--accent`, and the detectors table combined the runner tones
 * with the default variant's black border. Same idea, five different pictures.
 *
 * Two rules hold the scale together:
 *
 *  1. Colour comes from `accent-ink`, never `accent`. `--accent` is #b7ff00 in
 *     both themes — a surface that scores 1.21:1 on white — so any tone using
 *     it as text was invisible in light mode and only ever looked right because
 *     dark mode inverts the ground.
 *  2. Every tone is border + tinted background + ink, sized and shaped by
 *     `statusBadgeClass`, and applied to `<Badge variant="outline">`. The
 *     default variant paints its own background, border and shadow, which
 *     fights a tinted pill.
 */
export const STATUS_TONE = {
  /** Live, in flight, the thing you are waiting on. */
  active: "border-accent-ink/40 bg-accent/10 text-accent-ink",
  /** Started but not finished, or finished with reservations. */
  progress:
    "border-amber-600/35 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300",
  /** Finished, and finished well. */
  done: "border-border bg-accent text-accent-foreground",
  /** Nothing has happened to it yet. */
  idle: "border-border/60 bg-muted text-muted-foreground",
  /** Filed away, or deliberately set aside. */
  archived: "border-border/40 bg-transparent text-muted-foreground",
  /** It failed. */
  error:
    "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/15",
  /** Newly arrived — worth noticing, but not a problem. */
  fresh:
    "border-sky-600/35 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-950/40 dark:text-sky-300",
  /** Changed since last time. */
  changed:
    "border-violet-600/30 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-950/40 dark:text-violet-300",
  /** Present but unremarkable — a count, a label, a type. */
  neutral: "border-border/50 bg-transparent text-foreground",
} as const;

export type StatusTone = keyof typeof STATUS_TONE;

/**
 * Shared chrome for a status pill.
 *
 * `shadow-none` is load-bearing: `Badge`'s default variant carries
 * `shadow-[3px_3px_0_#000]`, and a tinted pill wearing a hard black drop shadow
 * inside a dense table reads as a rendering bug.
 */
export const statusBadgeClass =
  "rounded-[4px] border shadow-none font-mono text-[10px] uppercase tracking-[0.08em]";

/** Tone lookup that never throws on an enum the UI has not seen before. */
export function toneClass(tone: StatusTone | undefined | null): string {
  return (tone && STATUS_TONE[tone]) || STATUS_TONE.idle;
}
