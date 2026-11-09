"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { Bot, KeyRound, Server, Sparkles, User } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useActor, useActorName } from "@/hooks/use-actors";
import { useTranslation } from "@/hooks/use-translation";
import type { ActorKind } from "@/lib/actor-ref";

const ICONS: Record<ActorKind, typeof User> = {
  user: User,
  name: User,
  mcp: KeyRound,
  agent: Bot,
  system: Server,
};

/**
 * Who did something: a person, an agent, an MCP token or the system
 * (docs/prd/IAM-access-management.md §11.2). Renders nothing without a
 * reference, so callers can pass a nullable `createdBy` straight through.
 */
export function ActorChip({
  actorRef,
  className,
}: {
  actorRef: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const actor = useActor(actorRef);
  if (!actor) return null;

  const isAutopilot = actorRef === "agent:autopilot";
  const Icon = isAutopilot ? Sparkles : ICONS[actor.kind];
  const title =
    actor.kind === "name"
      ? t("actors.selfDeclared")
      : actor.via
        ? t("actors.viaToken", { token: actor.via })
        : t(`actors.kinds.${actor.kind}`);

  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 align-middle text-xs",
        isAutopilot ? "text-[#d97706]" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate font-medium text-foreground">
        {actor.name}
      </span>
      {actor.via && (
        <span className="truncate">
          {t("actors.via", { token: actor.via })}
        </span>
      )}
    </span>
  );
}

/**
 * An actor's display name for text that interpolates it, e.g.
 * `<ActorName actorRef={x}>{(name) => t("addedBy", { name })}</ActorName>`.
 */
export function ActorName({
  actorRef,
  children,
}: {
  actorRef: string | null | undefined;
  children?: (name: string) => ReactNode;
}) {
  const name = useActorName(actorRef);
  if (!name) return null;
  return <>{children ? children(name) : name}</>;
}
