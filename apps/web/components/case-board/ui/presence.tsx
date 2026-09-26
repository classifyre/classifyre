"use client";

import * as React from "react";
import { UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard } from "../store/board-context";
import { initialsOf } from "../store/selectors";
import { useActorName } from "../hooks/use-actor-name";

/**
 * Who is here (presence-lite, PRD §5.12): the other people with this board
 * open, then you. Clicking yourself sets the display name your edits carry.
 */
export function Presence() {
  const { t } = useTranslation();
  const others = useBoard((s) => s.presence);
  const [name, setName] = useActorName();
  const [draft, setDraft] = React.useState(name ?? "");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(name ?? "");
  }, [open, name]);

  const save = () => {
    setName(draft);
    setOpen(false);
  };

  return (
    <div className="flex shrink-0 items-center" data-testid="presence">
      {others.slice(0, 4).map((person, index) => (
        <Tooltip key={`${person}-${index}`}>
          <TooltipTrigger asChild>
            <span className="-mr-1.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-[10px] font-bold">
              {initialsOf(person)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("caseBoard.topBar.alsoHere", { names: person })}</TooltipContent>
        </Tooltip>
      ))}
      {others.length > 4 && (
        <span className="-mr-1.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-[10px]">
          +{others.length - 4}
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="ml-2 flex h-7 items-center gap-1 rounded-full border-2 border-foreground px-1 font-mono text-[10px] font-bold"
            aria-label={name ? t("caseBoard.presence.you", { name }) : t("caseBoard.actor.anonymous")}
            title={name ? t("caseBoard.presence.you", { name }) : t("caseBoard.actor.anonymous")}
          >
            {name ? (
              <span className="px-1">{initialsOf(name)}</span>
            ) : (
              <>
                <UserRound className="size-3.5" aria-hidden />
                <span className="hidden pr-1 font-sans text-[11px] font-medium whitespace-nowrap @6xl/topbar:inline">
                  {t("caseBoard.actor.anonymous")}
                </span>
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2 p-3">
          <p className="text-sm font-medium">{t("caseBoard.actor.prompt")}</p>
          <Input
            autoFocus
            value={draft}
            maxLength={64}
            placeholder={t("caseBoard.actor.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") save();
            }}
          />
          <p className="text-xs text-muted-foreground">{t("caseBoard.actor.hint")}</p>
          <div className="flex justify-end">
            <Button size="sm" onClick={save}>
              {t("caseBoard.actor.save")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
