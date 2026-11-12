"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  api,
  getActiveNamespaceSlug,
  type ResolvedActorDto,
} from "@workspace/api-client";
import { actorKind, needsResolving, type ActorKind } from "@/lib/actor-ref";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Display names for actor references, resolved in batches and cached per
 * workspace: a page full of timeline rows asks the API once, not once per row.
 * Self-declared names need no request; only MCP tokens and people do.
 */
const cache = new Map<string, ResolvedActorDto>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

const keyOf = (ref: string) => `${getActiveNamespaceSlug() ?? ""}|${ref}`;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function flush() {
  flushTimer = null;
  const refs = [...pending];
  pending.clear();
  if (refs.length === 0) return;
  // Outside a workspace (the tenant page) names come from the tenant.
  const resolve = getActiveNamespaceSlug()
    ? api.identity.auditControllerResolve({ refs })
    : api.access.tenantAccessControllerResolve({ refs });
  void resolve
    .then((resolved) => {
      for (const actor of resolved) cache.set(keyOf(actor.ref), actor);
      notify();
    })
    .catch((error: unknown) => {
      // A missing name is cosmetic: the chip falls back to the kind's label.
      console.error("Failed to resolve actors:", error);
    });
}

function request(ref: string) {
  if (!needsResolving(ref) || cache.has(keyOf(ref)) || pending.has(ref)) return;
  pending.add(ref);
  flushTimer ??= setTimeout(flush, 30);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ActorDisplay {
  kind: ActorKind;
  name: string;
  /** The MCP token a person's action came through. */
  via?: string;
}

/** What to show for an actor reference; null for no reference. */
export function useActor(ref: string | null | undefined): ActorDisplay | null {
  const { t } = useTranslation();
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );

  useEffect(() => {
    if (ref) request(ref);
  }, [ref]);

  if (!ref) return null;
  const kind = actorKind(ref);
  const resolved = cache.get(keyOf(ref));
  if (resolved) {
    return {
      kind,
      name: resolved.displayName,
      ...(resolved.viaDisplayName ? { via: resolved.viaDisplayName } : {}),
    };
  }
  if (kind === "name") return { kind, name: ref };
  if (kind === "agent") {
    return {
      kind,
      name: ref === "agent:autopilot" ? t("actors.autopilot") : ref.slice(6),
    };
  }
  if (kind === "system") return { kind, name: t("actors.system") };
  if (kind === "mcp") return { kind, name: t("actors.mcpToken") };
  if (kind === "group") return { kind, name: t("actors.group") };
  return { kind, name: t("actors.person") };
}

/** Just the name, for text that interpolates it ("Added by {{name}}"). */
export function useActorName(ref: string | null | undefined): string | null {
  return useActor(ref)?.name ?? null;
}
