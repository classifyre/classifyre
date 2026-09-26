"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@workspace/ui/lib/utils";
import { PORTS } from "../lib/geometry";

/** How far a port sits outside the node, so it never covers the node's own edge. */
const GAP = 9;

const SIDES = [
  { id: PORTS.top, position: Position.Top, dx: 0, dy: -1 },
  { id: PORTS.right, position: Position.Right, dx: 1, dy: 0 },
  { id: PORTS.bottom, position: Position.Bottom, dx: 0, dy: 1 },
  { id: PORTS.left, position: Position.Left, dx: -1, dy: 0 },
] as const;

/**
 * A node's four ports (PRD §5.4): one per side, a little off the node, each
 * both a place to pull a link from and a place to drop one. They show on the
 * node under the pointer only — never because a node is selected — and the
 * one a drop would land on lights up. Round nodes put them around the
 * circle's compass points; boxes beside their edges' middles.
 *
 * The right port doubles as the link tool's handle: with that tool on, it
 * grows over the node (or its circle) so the whole node starts a link.
 */
export function Ports({
  connectable,
  round,
  core,
  hidden = false,
}: {
  connectable: boolean;
  /**
   * Circle the ports sit around, in node coordinates; boxes leave it out.
   * `top`/`bottom` move those two past what sits above or below the circle
   * (hypothesis dots, the name), so a port never covers them.
   */
  round?: { cx: number; cy: number; r: number; top?: number; bottom?: number };
  /** What the link tool covers on a round node (defaults to the circle). */
  core?: { cx: number; cy: number; d: number };
  /** Edges still need the handles; nobody should see or use them. */
  hidden?: boolean;
}) {
  const live = connectable && !hidden;
  return (
    <>
      {SIDES.map((side) => {
        const main = side.id === PORTS.right;
        const y =
          side.id === PORTS.top && round?.top !== undefined
            ? round.top
            : side.id === PORTS.bottom && round?.bottom !== undefined
              ? round.bottom
              : round
                ? round.cy + side.dy * (round.r + GAP)
                : 0;
        const style: React.CSSProperties | undefined = round
          ? ({
              "--px": `${round.cx + side.dx * (round.r + GAP)}px`,
              "--py": `${y}px`,
              ...(main
                ? {
                    "--core-x": `${core?.cx ?? round.cx}px`,
                    "--core-y": `${core?.cy ?? round.cy}px`,
                    "--core-d": `${core?.d ?? 2 * round.r}px`,
                  }
                : {}),
            } as React.CSSProperties)
          : undefined;
        return (
          <Handle
            key={side.id}
            id={side.id}
            type="source"
            position={side.position}
            className={cn(
              "board-port",
              round ? "board-port-round" : "board-port-box",
              main && "board-port-main",
              hidden && "board-port-hidden",
            )}
            style={style}
            isConnectable={live}
          />
        );
      })}
    </>
  );
}
