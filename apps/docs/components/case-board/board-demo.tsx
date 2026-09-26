"use client";

import "@xyflow/react/dist/base.css";
import "@workspace/case-board/board.css";

import dynamic from "next/dynamic";
import { SCENES, type SceneName } from "./scenes";

/** The canvas only makes sense in a browser: it measures what it draws. */
const BoardDemo = dynamic(() => import("@workspace/case-board/demo").then((m) => m.BoardDemo), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted/40" />,
});

/**
 * A live case board inside a docs page, drawn by the board's own components.
 * Readers can drag things, select, focus a hypothesis and pull links; Reset
 * puts the scene back. Nothing is saved anywhere.
 */
export function CaseBoardDemo({
  scene,
  height = 420,
  zoom,
  caption,
}: {
  scene: SceneName;
  height?: number;
  /** Open at a fixed zoom instead of fitting everything in. */
  zoom?: number;
  caption?: string;
}) {
  const { label, ...definition } = SCENES[scene];
  return (
    <figure className="my-6">
      <div style={{ height }} className="rounded-[4px] border border-border">
        <BoardDemo scene={definition} height={height - 2} zoom={zoom} label={label} className="border-0" />
      </div>
      {caption && <figcaption className="mt-2 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
