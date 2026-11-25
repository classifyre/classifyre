"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard } from "../store/board-context";
import { initialsOf } from "../store/selectors";

/**
 * Who is here (presence-lite, PRD §5.12): the other signed-in people with
 * this board open.
 */
export function Presence() {
  const others = useBoard((s) => s.presence);
  return <PresenceChips others={others} testId="presence" />;
}

/**
 * Reusable presence avatar stack shared by investigation boards and data
 * request workspaces.
 */
export function PresenceChips({
  others,
  testId = "presence",
  maxVisible = 4,
}: {
  others: string[];
  testId?: string;
  maxVisible?: number;
}) {
  const { t } = useTranslation();
  if (others.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center" data-testid={testId}>
      {others.slice(0, maxVisible).map((person, index) => (
        <Tooltip key={`${person}-${index}`}>
          <TooltipTrigger asChild>
            <span className="-mr-1.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-[10px] font-bold">
              {initialsOf(person)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("caseBoard.topBar.alsoHere", { names: person })}
          </TooltipContent>
        </Tooltip>
      ))}
      {others.length > maxVisible && (
        <span className="-mr-1.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-[10px]">
          +{others.length - maxVisible}
        </span>
      )}
    </div>
  );
}
