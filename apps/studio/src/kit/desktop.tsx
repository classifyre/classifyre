import type { CSSProperties, ReactNode } from "react";
import {
  BatteryMedium,
  ChevronLeft,
  ChevronRight,
  Lock,
  RotateCw,
  Search,
  Wifi,
} from "lucide-react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cn } from "@workspace/ui/lib/utils";
import "./desktop.css";
import { glide } from "./timing";

/*
 * The laptop a story happens on: a desktop, windows, a browser, a pointer, and
 * the camera that looks at them. These are drawn for the videos; the product
 * inside the browser never is.
 */

export const SCREEN = { width: 1920, height: 1080 } as const;
const MENU_BAR = 34;

export function Desktop({
  clock,
  app = "Finder",
  dim = 0,
  children,
}: {
  /** What the menu bar clock reads. */
  clock: string;
  /** The application in front, named in the menu bar. */
  app?: string;
  /** 0 a lit screen, 1 a dark one. */
  dim?: number;
  children?: ReactNode;
}) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#050604" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(1200px 700px at 78% 18%, rgba(183,255,0,0.10), transparent 60%), radial-gradient(900px 600px at 12% 88%, rgba(183,255,0,0.06), transparent 65%), linear-gradient(160deg, #10130c 0%, #060705 55%, #0a0c08 100%)",
        }}
      />
      <AbsoluteFill className="landing-grid opacity-40" />
      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between bg-black/55 px-5 font-sans text-[15px] text-white/90"
        style={{ height: MENU_BAR }}
      >
        <div className="flex items-center gap-6">
          <span className="size-[15px] rounded-[4px] bg-white/85" />
          <span className="font-semibold">{app}</span>
          {["File", "Edit", "View", "Window", "Help"].map((menu) => (
            <span key={menu} className="text-white/70">
              {menu}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-5 text-white/80">
          <BatteryMedium className="size-5" />
          <Wifi className="size-[18px]" />
          <Search className="size-4" />
          <span className="tabular-nums">{clock}</span>
        </div>
      </div>
      {children}
      <AbsoluteFill
        style={{
          backgroundColor: "black",
          opacity: dim,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WindowProps extends Box {
  title?: ReactNode;
  /** What sits in the title bar instead of a title: a browser's address row. */
  bar?: ReactNode;
  /** 0 → 1 as the window opens. */
  open?: number;
  /** A window behind the one in front. */
  back?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export const TITLE_BAR = 52;

export function Window({
  x,
  y,
  w,
  h,
  title,
  bar,
  open = 1,
  back = false,
  className,
  style,
  children,
}: WindowProps) {
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-[14px] border border-white/15 bg-[#0b0b0b]",
        className,
      )}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: interpolate(open, [0, 0.6], [0, 1], {
          extrapolateRight: "clamp",
        }),
        scale: interpolate(open, [0, 1], [0.94, 1]),
        boxShadow: back
          ? "0 20px 50px rgba(0,0,0,0.45)"
          : "0 40px 110px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        ...style,
      }}
    >
      <div
        className="relative flex items-center gap-4 border-b border-white/10 bg-[#1b1b1b] px-5"
        style={{ height: TITLE_BAR }}
      >
        <div className="flex shrink-0 items-center gap-[9px]">
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span
              key={color}
              className="size-[13px] rounded-full"
              style={{ backgroundColor: back ? "#4a4a4a" : color }}
            />
          ))}
        </div>
        {bar ?? (
          <div className="absolute inset-x-0 text-center font-sans text-[15px] font-medium text-white/70">
            {title}
          </div>
        )}
      </div>
      <div className="relative" style={{ height: h - TITLE_BAR }}>
        {children}
      </div>
    </div>
  );
}

interface BrowserProps extends Box {
  url: string;
  /** Whether the address is still being typed: shows the caret and no padlock. */
  typing?: boolean;
  open?: number;
  back?: boolean;
  /** How much larger than life the page is drawn. */
  zoom?: number;
  /** How far the page is scrolled, in the page's own pixels. */
  scroll?: number;
  children?: ReactNode;
}

/** A browser window. The page is laid out `zoom` times smaller and magnified. */
export function Browser({
  url,
  typing = false,
  zoom = 1.2,
  scroll = 0,
  children,
  ...box
}: BrowserProps) {
  return (
    <Window
      {...box}
      bar={
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <ChevronLeft className="size-5 text-white/50" />
          <ChevronRight className="size-5 text-white/25" />
          <div className="mx-auto flex h-[34px] w-[640px] items-center justify-center gap-2 rounded-[9px] bg-black/55 font-sans text-[15px] text-white/85">
            {!typing && <Lock className="size-3.5 text-white/45" />}
            <span>{url}</span>
            {typing && <span className="-ml-1.5 h-[18px] w-px bg-white/80" />}
          </div>
          <RotateCw className="size-4 text-white/45" />
        </div>
      }
    >
      <div
        data-film-page
        className="absolute left-0 top-0 origin-top-left bg-background"
        style={{
          width: box.w / zoom,
          height: (box.h - TITLE_BAR) / zoom,
          transform: `scale(${zoom})`,
          overflow: "hidden",
        }}
      >
        <div style={{ transform: `translateY(${-scroll}px)` }}>{children}</div>
      </div>
    </Window>
  );
}

export interface CursorStop {
  /** The frame the pointer arrives on. */
  at: number;
  x: number;
  y: number;
  click?: boolean;
  /** How many frames the trip there takes. */
  move?: number;
}

/** The pointer: it travels to each stop, arriving on the stop's frame. */
export function Cursor({ stops }: { stops: CursorStop[] }) {
  const frame = useCurrentFrame();
  const [first] = stops;
  if (!first) return null;

  let x = first.x;
  let y = first.y;
  for (const [index, stop] of stops.entries()) {
    const previous = stops[index - 1];
    if (!previous) continue;
    const move = stop.move ?? 22;
    const t = glide(frame, stop.at - move, move);
    if (t <= 0) break;
    x = interpolate(t, [0, 1], [previous.x, stop.x]);
    y = interpolate(t, [0, 1], [previous.y, stop.y]);
  }

  const clicked = stops.filter((stop) => stop.click && stop.at <= frame).at(-1);
  const since = clicked ? frame - clicked.at : Infinity;
  const shown = interpolate(frame, [first.at - 12, first.at], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ opacity: shown }}
    >
      {clicked && since < 16 && (
        <div
          className="absolute rounded-full border-2 border-accent"
          style={{
            left: clicked.x,
            top: clicked.y,
            width: 64,
            height: 64,
            translate: "-50% -50%",
            scale: interpolate(since, [0, 16], [0.2, 1]),
            opacity: interpolate(since, [0, 16], [0.9, 0]),
          }}
        />
      )}
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        className="absolute"
        style={{
          left: x,
          top: y,
          scale: since < 6 ? 0.86 : 1,
          transformOrigin: "top left",
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.55))",
        }}
      >
        <path
          d="M4 2.5v17l4.6-4.3 3 6.6 2.7-1.2-3-6.5h6.4z"
          fill="black"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * The camera: the whole screen magnified about a point, which moves. Keys are
 * [frame, focus x, focus y, zoom]; at zoom 1 the focus does not matter.
 */
export function Camera({
  keys,
  children,
}: {
  keys: readonly (readonly [number, number, number, number])[];
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const at = keys.map(([key]) => key);
  const value = (index: 1 | 2 | 3) =>
    keys.length === 1
      ? (keys[0]?.[index] ?? 1)
      : interpolate(
          frame,
          at,
          keys.map((key) => key[index]),
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: (t) =>
              t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
          },
        );
  const zoom = value(3);
  // Keep the focus where it is on screen as far as the edges allow.
  const shift = (focus: number, size: number) =>
    Math.min(0, Math.max(size - size * zoom, size / 2 - focus * zoom));

  return (
    <AbsoluteFill
      style={{
        transformOrigin: "0 0",
        transform: `translate(${shift(value(1), SCREEN.width)}px, ${shift(value(2), SCREEN.height)}px) scale(${zoom})`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
