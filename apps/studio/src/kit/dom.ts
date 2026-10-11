import { useLayoutEffect, useState, type RefObject } from "react";
import type { CursorStop } from "./desktop";

/*
 * The product's components keep their own state (a catalog's search box) and
 * decide their own layout. Rather than rebuild them to be told what to show,
 * a video types into them and measures them, once per frame, the way a person
 * at the keyboard would.
 */

export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Finder = string | ((root: HTMLElement) => Element | null | undefined);

/** The smallest element of `tag` whose text is exactly `text`. */
export function byText(tag: string, text: string): Finder {
  return (root) =>
    [...root.querySelectorAll(tag)]
      .filter((element) => element.textContent?.trim() === text)
      .at(-1);
}

/**
 * Where things are, in the coordinates of `root` as authored (1920 wide), so
 * a camera or the preview's own scaling round it does not matter. Measured
 * after every render: scrolling and typing move things.
 */
export function useSpots<Name extends string>(
  root: RefObject<HTMLElement | null>,
  finders: Record<Name, Finder>,
  width = 1920,
): Partial<Record<Name, Spot>> {
  const [spots, setSpots] = useState<Partial<Record<Name, Spot>>>({});

  // No dependency list on purpose: anything a render changes can move things.
  // It settles because the state is only set when a measurement differs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const frame = node.getBoundingClientRect();
    const scale = frame.width / width || 1;
    const next: Partial<Record<Name, Spot>> = {};
    for (const name of Object.keys(finders) as Name[]) {
      const finder = finders[name];
      const element =
        typeof finder === "string" ? node.querySelector(finder) : finder(node);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      next[name] = {
        x: Math.round((box.left - frame.left) / scale),
        y: Math.round((box.top - frame.top) / scale),
        w: Math.round(box.width / scale),
        h: Math.round(box.height / scale),
      };
    }
    setSpots((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  });

  return spots;
}

export interface Visit {
  at: number;
  /** A spot's name, or a point. */
  to: string | { x: number; y: number };
  click?: boolean;
  move?: number;
  /** Where in the spot to land, 0–1 across and down. Default its middle. */
  anchor?: [number, number];
}

/** A pointer's itinerary, with each named spot resolved to where it is now. */
export function route(
  spots: Partial<Record<string, Spot>>,
  visits: Visit[],
): CursorStop[] {
  const stops: CursorStop[] = [];
  for (const visit of visits) {
    const previous = stops.at(-1);
    const spot = typeof visit.to === "string" ? spots[visit.to] : undefined;
    const [ax, ay] = visit.anchor ?? [0.5, 0.5];
    const point =
      typeof visit.to === "string"
        ? spot
          ? { x: spot.x + spot.w * ax, y: spot.y + spot.h * ay }
          : (previous ?? { x: 1200, y: 700 })
        : visit.to;
    stops.push({
      at: visit.at,
      x: point.x,
      y: point.y,
      click: visit.click,
      move: visit.move,
    });
  }
  return stops;
}

/** Types into one of React's inputs so that its onChange hears it. */
export function fill(input: Element | null | undefined, value: string): void {
  if (
    !(
      input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
    ) ||
    input.value === value
  ) {
    return;
  }
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Runs `act` on the root after every render: the film's hands on the page. */
export function useHands(
  root: RefObject<HTMLElement | null>,
  act: (root: HTMLElement) => void,
): void {
  useLayoutEffect(() => {
    if (root.current) act(root.current);
  });
}

/**
 * How far down its page each thing is, whatever the page is scrolled to at the
 * moment: what a scene needs to know to scroll something into view. `top` is
 * where the page starts in `root`, `zoom` how much it is magnified, and
 * `scroll` holds how far the scene scrolled it in the render being measured
 * (the scene sets it while rendering, since the scroll is worked out from
 * these very offsets).
 */
export function useOffsets<Name extends string>(
  root: RefObject<HTMLElement | null>,
  finders: Record<Name, Finder>,
  page: { top: number; zoom: number },
  scroll: RefObject<number>,
): Partial<Record<Name, number>> {
  const [offsets, setOffsets] = useState<Partial<Record<Name, number>>>({});

  // Measured after every render, like useSpots, and settling the same way.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const frame = node.getBoundingClientRect();
    const scale = frame.width / 1920 || 1;
    const next: Partial<Record<Name, number>> = {};
    for (const name of Object.keys(finders) as Name[]) {
      const finder = finders[name];
      const element =
        typeof finder === "string" ? node.querySelector(finder) : finder(node);
      if (!element) continue;
      const y = (element.getBoundingClientRect().top - frame.top) / scale;
      next[name] = Math.round((y - page.top) / page.zoom + scroll.current);
    }
    setOffsets((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  });

  return offsets;
}
