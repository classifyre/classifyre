"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@workspace/ui/lib/utils";
import { PORTS, roundPortCentre, type RoundPorts } from "../lib/geometry";

const SIDES = [
  { id: PORTS.top, position: Position.Top },
  { id: PORTS.right, position: Position.Right },
  { id: PORTS.bottom, position: Position.Bottom },
  { id: PORTS.left, position: Position.Left },
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
  /** Circle the ports sit around (see RoundPorts); boxes leave it out. */
  round?: RoundPorts;
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
        const at = round ? roundPortCentre(round, side.id) : null;
        const style: React.CSSProperties | undefined =
          round && at
            ? ({
                "--px": `${at.x}px`,
                "--py": `${at.y}px`,
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
