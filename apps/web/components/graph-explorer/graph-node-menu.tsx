"use client";

import * as React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";

/** Where a right-click on a canvas graph opened its menu, and on what. */
export interface GraphMenuAt<T> {
  x: number;
  y: number;
  target: T;
}

/**
 * The right-click menu of a canvas graph. The canvas finds what is under the
 * pointer itself (a node, an edge), so the menu is a dropdown anchored to the
 * pointer rather than a context-menu trigger around the canvas — which could
 * not tell a node from the empty background. Rendered in a portal, so it is
 * not clipped by a narrow side panel.
 */
export function GraphNodeMenu<T>({
  menu,
  onClose,
  children,
  className = "w-60",
}: {
  menu: GraphMenuAt<T> | null;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!menu) return null;
  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: "fixed", left: menu.x, top: menu.y, width: 1, height: 1 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className={className} data-testid="graph-node-menu">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
