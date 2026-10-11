import type { CSSProperties, ReactNode } from "react";
import { Img, interpolate, random, useCurrentFrame } from "remotion";
import { cn } from "@workspace/ui/lib/utils";
import { arrive } from "./timing";

/*
 * What a film is made of when it is not showing the product: paper on a black
 * table. Sheets, photographs cut out with scissors, rubber stamps, a lime
 * marker and lime thread. All of it is the film's own drawing and none of it
 * looks like the product, which is the point: a viewer can tell at a glance
 * what is Classifyre and what is us explaining.
 *
 * Imported by path (`src/kit/paper`), not from the kit's index: a video that
 * never leaves the app has no use for it.
 */

export const PAPER = "#f3efe4";
export const INK = "#0b0b0a";
export const LIME = "#b7ff00";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Paper has a tooth. One small tile of noise, the same on every render. */
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.11 0'/></filter><rect width='220' height='220' filter='url(#n)'/></svg>`,
)}")`;

export interface Placed {
  x: number;
  y: number;
  /** Degrees. Nothing on a table lies straight. */
  rotate?: number;
  /** 0 → 1 as it is put down. */
  shown?: number;
  /** Where it comes from, in pixels, while it is being put down. */
  from?: [number, number];
  z?: number;
}

/** The transform of something being put down on the table: it slides in, turning a little, and lands. */
export function put({
  x,
  y,
  rotate = 0,
  shown = 1,
  from = [0, 90],
  z,
}: Placed): CSSProperties {
  return {
    position: "absolute",
    left: x,
    top: y,
    zIndex: z,
    opacity: interpolate(shown, [0, 0.25], [0, 1], CLAMP),
    translate: `${(1 - shown) * from[0]}px ${(1 - shown) * from[1]}px`,
    rotate: `${rotate + (1 - shown) * 5}deg`,
    scale: String(1.06 - 0.06 * shown),
  };
}

/** A straight edge torn by hand: the points of a polygon along one side. */
function torn(seed: string, steps = 26, depth = 1.6): string {
  const points: string[] = ["0% 0%", "100% 0%"];
  for (let i = steps; i >= 0; i -= 1) {
    const dip = random(`${seed}-${i}`) * depth;
    points.push(`${(i / steps) * 100}% ${100 - dip}%`);
  }
  return `polygon(${points.join(", ")})`;
}

/** A sheet of paper. `tear` gives it a torn foot. */
export function Sheet({
  w,
  h,
  tear,
  tone = PAPER,
  className,
  children,
  ...placed
}: Placed & {
  w: number;
  h?: number;
  /** A name: the same name always tears the same way. */
  tear?: string;
  tone?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        ...put(placed),
        width: w,
        height: h,
        filter: "drop-shadow(0 18px 26px rgba(0,0,0,0.55))",
      }}
    >
      <div
        className={cn("relative h-full w-full overflow-hidden", className)}
        style={{
          backgroundColor: tone,
          backgroundImage: GRAIN,
          color: INK,
          clipPath: tear ? torn(tear) : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A photograph and the snips round it: the picture's size, and the corners of
 * the outline in percent of it (PLAYBOOK.md, "The table", says how the
 * outline is made). A video keeps its own in film/photos/.
 */
export interface Photo {
  src: string;
  w: number;
  h: number;
  cut: readonly (readonly number[])[];
}

/**
 * A photograph cut out with scissors: a few straight snips round the thing,
 * a margin of white paper left on.
 */
export function Cutout({
  photo,
  width,
  ...placed
}: Placed & { photo: Photo; width: number }) {
  return (
    <div
      style={{
        ...put(placed),
        width,
        height: (width * photo.h) / photo.w,
        filter: "drop-shadow(0 16px 22px rgba(0,0,0,0.6))",
      }}
    >
      <Img
        src={photo.src}
        className="block h-full w-full"
        style={{
          clipPath: `polygon(${photo.cut.map(([px, py]) => `${px}% ${py}%`).join(", ")})`,
        }}
      />
    </div>
  );
}

/**
 * A photograph kept as a print: a white border, a mono caption strip under
 * it. For a picture of a place, which is not cut out (PLAYBOOK.md, "The
 * table").
 */
export function Print({
  photo,
  width,
  caption,
  ...placed
}: Placed & { photo: Photo; width: number; caption?: string }) {
  return (
    <div
      style={{
        ...put(placed),
        width,
        filter: "drop-shadow(0 18px 26px rgba(0,0,0,0.6))",
      }}
    >
      <div className="p-[14px] pb-[16px]" style={{ backgroundColor: PAPER }}>
        <Img
          src={photo.src}
          className="block w-full"
          style={{ height: ((width - 28) * photo.h) / photo.w }}
        />
        {caption && (
          <p className="pt-[10px] font-mono text-[15px] font-semibold uppercase tracking-[0.18em] text-black/70">
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

/** A strip of tape across a corner. */
export function Tape({
  x,
  y,
  w = 130,
  rotate = -8,
  shown = 1,
}: {
  x: number;
  y: number;
  w?: number;
  rotate?: number;
  shown?: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: 34,
        rotate: `${rotate}deg`,
        opacity: shown * 0.82,
        backgroundColor: "rgba(232,226,200,0.9)",
        backgroundImage: GRAIN,
        boxShadow: "0 2px 5px rgba(0,0,0,0.35)",
      }}
    />
  );
}

/**
 * A rubber stamp. It comes down hard: large and faint, then at size and
 * inked, with a small recoil. `at` is the frame it lands on.
 */
export function Stamp({
  at,
  tone = "lime",
  rotate = -7,
  size = 30,
  className,
  style,
  children,
}: {
  at: number;
  tone?: "lime" | "paper" | "ink";
  rotate?: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const since = frame - at;
  if (since < -4) return null;
  const color = tone === "lime" ? LIME : tone === "paper" ? PAPER : INK;
  return (
    <div
      className={cn(
        "inline-block whitespace-nowrap border-[4px] px-[0.55em] py-[0.22em] font-mono font-bold uppercase leading-none tracking-[0.2em]",
        className,
      )}
      style={{
        fontSize: size,
        color,
        borderColor: color,
        rotate: `${rotate}deg`,
        opacity: interpolate(since, [-4, 0, 3], [0, 0.55, 1], CLAMP),
        scale: interpolate(since, [-4, 0, 3, 7], [1.9, 1.08, 0.96, 1], CLAMP),
        // An uneven impression: the rubber never takes the ink evenly.
        maskImage:
          "radial-gradient(120% 90% at 30% 40%, #000 62%, rgba(0,0,0,0.7) 100%)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The film's own label on a picture: a lime tag in mono capitals. */
export function Tag({
  className,
  style,
  tone = "lime",
  children,
}: {
  className?: string;
  style?: CSSProperties;
  tone?: "lime" | "paper" | "outline";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap px-3 py-1.5 font-mono text-[17px] font-bold uppercase leading-none tracking-[0.18em]",
        tone === "lime" && "bg-accent text-black",
        tone === "paper" && "bg-[#f3efe4] text-black",
        tone === "outline" &&
          "border-2 border-dashed border-white/80 bg-black/80 text-white",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/** A black panel with a white hairline: the film explaining something next to a screen. */
export function Panel({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border border-white/70 bg-black/92 px-6 py-5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.7)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** Words gone over with the lime marker, left to right, from frame `at`. */
export function Marker({
  at,
  frames = 12,
  children,
}: {
  at: number;
  frames?: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const drawn = arrive(frame, at, frames);
  return (
    <span className="relative inline-block">
      <span
        className="absolute -inset-x-[0.14em] bottom-[0.02em] top-[0.12em] origin-left"
        style={{
          backgroundColor: LIME,
          scale: `${drawn} 1`,
          rotate: "-0.6deg",
        }}
      />
      <span className="relative" style={{ color: drawn > 0.5 ? INK : undefined }}>
        {children}
      </span>
    </span>
  );
}

/**
 * Words gone over with the lime marker, however many lines they run to.
 * `Marker` is one piece and cannot wrap; this marks each word by itself, a
 * frame and a half after the one before, so a whole sentence in the middle of
 * a paragraph can be marked. For dark text on paper.
 */
export function Marked({ at, children }: { at: number; children: string }) {
  const frame = useCurrentFrame();
  const words = children.split(" ");
  return (
    <>
      {words.map((word, index) => {
        const drawn = arrive(frame, at + index * 1.5, 5);
        return (
          <span key={index} className="relative inline-block whitespace-pre">
            <span
              className="absolute inset-x-0 bottom-[0.08em] top-[0.1em] origin-left"
              style={{ backgroundColor: LIME, scale: `${drawn} 1` }}
            />
            <span className="relative">
              {word}
              {index < words.length - 1 ? " " : ""}
            </span>
          </span>
        );
      })}
    </>
  );
}

/** A length of lime thread from one pin to another, paid out from frame `at`. */
export function Thread({
  from,
  to,
  at,
  frames = 16,
  sag = 26,
  color = LIME,
  width = 3,
}: {
  from: [number, number];
  to: [number, number];
  at: number;
  frames?: number;
  sag?: number;
  color?: string;
  width?: number;
}) {
  const frame = useCurrentFrame();
  const drawn = arrive(frame, at, frames);
  if (drawn <= 0) return null;
  const mid: [number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2 + sag,
  ];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) + sag * 1.2;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <path
        d={`M ${from[0]} ${from[1]} Q ${mid[0]} ${mid[1]} ${to[0]} ${to[1]}`}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - drawn)}
        style={{ filter: "drop-shadow(0 3px 2px rgba(0,0,0,0.6))" }}
      />
    </svg>
  );
}

/** A map pin, seen from above. */
export function Pin({
  x,
  y,
  shown = 1,
  color = LIME,
}: {
  x: number;
  y: number;
  shown?: number;
  color?: string;
}) {
  return (
    <span
      className="absolute rounded-full"
      style={{
        left: x - 9,
        top: y - 9,
        width: 18,
        height: 18,
        backgroundColor: color,
        scale: String(shown),
        boxShadow:
          "inset -3px -3px 0 rgba(0,0,0,0.28), 0 4px 5px rgba(0,0,0,0.6)",
      }}
    />
  );
}

/** A line drawn by hand with the marker: any SVG path, drawn from frame `at`. */
export function Stroke({
  d,
  at,
  frames = 14,
  length = 600,
  width = 5,
  color = LIME,
  className,
}: {
  d: string;
  at: number;
  frames?: number;
  /** A length at least as long as the path. */
  length?: number;
  width?: number;
  color?: string;
  className?: string;
}) {
  const frame = useCurrentFrame();
  const drawn = arrive(frame, at, frames);
  if (drawn <= 0) return null;
  return (
    <svg
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full overflow-visible",
        className,
      )}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - drawn)}
      />
    </svg>
  );
}

/** Lines of grey: text nobody is meant to read. */
export function Greeking({
  lines,
  seed,
  className,
}: {
  lines: number;
  seed: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-[9px]", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="h-[7px] bg-black/25"
          style={{ width: `${62 + random(`${seed}-${index}`) * 38}%` }}
        />
      ))}
    </div>
  );
}

/** The black table everything lies on, lit from above the middle. */
export function Desk({ children }: { children?: ReactNode }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(1300px 760px at 50% 42%, #1b1c18 0%, #0c0d0b 55%, #050505 100%)",
      }}
    >
      <div className="absolute inset-0" style={{ backgroundImage: GRAIN, opacity: 0.5 }} />
      {children}
    </div>
  );
}
