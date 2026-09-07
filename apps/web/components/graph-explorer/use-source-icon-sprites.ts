"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { getSourceTypeIcon } from "@workspace/ui/components/source-icon";

/**
 * Source-type icons, rasterised so a `<canvas>` can draw them.
 *
 * The icon set is React components (lucide glyphs and simple-icons paths), and
 * the graph is a canvas, so there is a conversion to make. Rendering each one
 * into a detached div with `createRoot` + `flushSync`, serialising the SVG it
 * produces and handing that to an `Image` keeps the single source of truth —
 * add a connector to `SOURCE_ICON_BY_TYPE` and it appears on the map, with no
 * second icon table to forget to update.
 *
 * `react-dom/server` would be the obvious tool and is deliberately not used: it
 * is a separate bundle to ship to the browser for something the client renderer
 * already does.
 *
 * Sprites are cached per (type, colour). Colour is baked in because canvas has
 * no way to tint a drawn image cheaply, and the icons are authored with
 * `fill="currentColor"` — which resolves to nothing inside an `Image`.
 */
const spriteCache = new Map<string, HTMLImageElement>();

/** Rendered at 4x the largest on-screen size so the glyph stays crisp zoomed in. */
const SPRITE_PX = 96;

function renderIconMarkup(sourceType: string): string | null {
  if (typeof document === "undefined") return null;
  const Icon = getSourceTypeIcon(sourceType);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(React.createElement(Icon, { className: "sprite" }));
    });
    const svg = host.querySelector("svg");
    if (!svg) return null;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(SPRITE_PX));
    svg.setAttribute("height", String(SPRITE_PX));
    // Lucide glyphs are strokes, simple-icons are fills. Neither resolves
    // `currentColor` inside an <img>, so both get an explicit value.
    return new XMLSerializer().serializeToString(svg);
  } finally {
    // Unmount on a later task: React refuses to unmount during a flushSync pass.
    setTimeout(() => root.unmount(), 0);
  }
}

const cacheKeyOf = (sourceType: string, color: string) => `${sourceType}|${color}`;

/**
 * Rasterise one icon. Only ever called from the preload effect: it renders a
 * React tree, and the canvas draw runs inside `requestAnimationFrame`, where
 * kicking off a synchronous render would be both surprising and avoidable.
 */
function loadSprite(sourceType: string, color: string): HTMLImageElement | null {
  const cacheKey = cacheKeyOf(sourceType, color);
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const markup = renderIconMarkup(sourceType);
  if (!markup) return null;

  const painted = markup
    .replace(/currentColor/g, color)
    .replace(/stroke="none"/g, `stroke="none"`);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(painted)}`;
  spriteCache.set(cacheKey, image);
  return image;
}

export interface SourceIconSprites {
  /** The decoded sprite for a source type, or null while it is still loading. */
  get: (sourceType: string | undefined | null) => HTMLImageElement | null;
}

/**
 * Preloads a sprite per source type and re-renders once they are all decoded,
 * so the canvas never draws a half-loaded icon and never has to poll.
 */
export function useSourceIconSprites(
  sourceTypes: string[],
  color: string,
): SourceIconSprites {
  const key = React.useMemo(
    () => [...new Set(sourceTypes)].sort().join(","),
    [sourceTypes],
  );
  const [version, bumpVersion] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const pending = key
      .split(",")
      .map((type) => loadSprite(type, color))
      .filter((image): image is HTMLImageElement => image != null && !image.complete);

    // Nothing left to decode: the sprites were rendered synchronously above, so
    // tell the canvas they are available now rather than waiting for a load
    // event that will never fire.
    if (pending.length === 0) {
      bumpVersion();
      return;
    }
    let settled = 0;
    const onSettle = () => {
      settled += 1;
      if (!cancelled && settled === pending.length) bumpVersion();
    };
    for (const image of pending) {
      image.addEventListener("load", onSettle, { once: true });
      image.addEventListener("error", onSettle, { once: true });
    }
    return () => {
      cancelled = true;
      for (const image of pending) {
        image.removeEventListener("load", onSettle);
        image.removeEventListener("error", onSettle);
      }
    };
  }, [key, color]);

  return React.useMemo<SourceIconSprites>(
    () => ({
      // Cache read only — a miss means "not preloaded yet", and the bubble
      // simply draws without its mark until the effect above fills it in.
      get: (sourceType) => {
        if (!sourceType) return null;
        const image = spriteCache.get(cacheKeyOf(sourceType, color));
        return image?.complete && image.naturalWidth > 0 ? image : null;
      },
    }),
    // `version` is the whole point, and the lint rule cannot see it: the
    // resolver closes over a module-level mutable cache, so its identity has to
    // change when sprites finish decoding, or the canvas keeps the pre-load
    // resolver and never redraws with the icons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, version],
  );
}
