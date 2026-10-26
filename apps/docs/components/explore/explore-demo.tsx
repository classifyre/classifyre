"use client";

import "@xyflow/react/dist/base.css";
import "@workspace/case-board/board.css";

import dynamic from "next/dynamic";
import { EXPLORE_SCENES, type ExploreSceneName } from "./scenes";

/** The canvas only makes sense in a browser. */
const Demo = dynamic(() => import("@workspace/case-board/explore").then((m) => m.ExploreDemo), {
  ssr: false,
  loading: () => <div className="h-[520px] w-full animate-pulse bg-muted/40" />,
});

/**
 * A live Explore canvas inside a docs page, drawn by the app's own
 * components: switch kinds on and off, click anything to read why it is
 * there, press "+" to walk on, pull a link from one asset to another.
 * Nothing is saved anywhere.
 */
export function ExploreDemo({
  scene,
  height = 460,
  caption,
}: {
  scene: ExploreSceneName;
  height?: number;
  caption?: string;
}) {
  const { label, ...definition } = EXPLORE_SCENES[scene];
  return (
    <figure className="my-6">
      <Demo scene={definition} height={height} label={label} />
      {caption && <figcaption className="mt-2 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
