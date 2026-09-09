"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Layers,
  Settings,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import type { Namespace, NamespaceStats } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useTranslation } from "@/hooks/use-translation";

/** The card's loading twin, so a grid of them keeps its rhythm while data lands. */
export function WorkspaceCardSkeleton() {
  return (
    <Card aria-hidden="true" className="gap-0 overflow-hidden py-0 shadow-none">
      <Skeleton className="aspect-[16/8.5] w-full rounded-none bg-muted" />
      <CardContent className="space-y-4 p-5">
        <Skeleton className="h-5 w-2/3 bg-muted" />
        <Skeleton className="h-3 w-1/2 bg-muted" />
        <Skeleton className="h-10 w-full bg-muted" />
        <Skeleton className="ml-auto h-4 w-16 bg-muted" />
      </CardContent>
    </Card>
  );
}

/**
 * One workspace in a directory grid — shared by the landing directory and the
 * category pages so a workspace looks the same wherever it is filed.
 *
 * The whole card is the "open" affordance; every control inside it (settings,
 * delete, an external link) stops propagation so it does not also open the
 * workspace.
 */
export function WorkspaceCard({
  namespace: ns,
  stats,
  onOpen,
  onDelete,
}: {
  namespace: Namespace;
  stats?: NamespaceStats;
  onOpen: (namespace: Namespace) => void;
  /** Omit to render a card with no delete affordance. */
  onDelete?: (namespace: Namespace) => void;
}) {
  const { t } = useTranslation();
  const initial = ns.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <Card
      clickable
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ns)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(ns);
        }
      }}
      aria-label={t("workspaces.openAria", { name: ns.name })}
      className="group gap-0 overflow-hidden bg-card/95 py-0 shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none"
    >
      <div className="relative aspect-[16/8.5] overflow-hidden border-b bg-muted">
        {ns.thumbnail ? (
          <Image
            src={ns.thumbnail}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover object-top transition duration-200 group-hover:scale-[1.01]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary">
            <span className="font-serif text-6xl text-muted-foreground/25">
              {initial}
            </span>
          </div>
        )}
      </div>

      <CardContent className="flex min-h-40 flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold uppercase tracking-[0.06em]">
              {ns.name}
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              /{ns.slug}
            </p>
          </div>
          <div className="-mr-2 -mt-2 flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="text-muted-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <Link
                href={`/namespaces/${ns.id}/settings`}
                aria-label={t("workspaces.settingsAria", { name: ns.name })}
              >
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(ns);
                }}
                aria-label={t("workspaces.deleteAria", { name: ns.name })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {ns.description || t("workspaces.noDescription")}
        </p>

        {ns.externalLinks.length > 0 && (
          // A hairline-ruled list, not a row of pills: these are destinations
          // the operator reads down, and a name long enough to matter should
          // get the width to show it.
          <ul className="mt-4 border-t border-border/70">
            {ns.externalLinks.map((link) => (
              <li key={link.id} className="border-b border-border/70">
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="group/link h-8 w-full justify-start gap-2 rounded-none px-1.5 text-xs font-normal text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.title}
                    aria-label={t("workspaces.linkOpenAria", {
                      name: link.title,
                    })}
                  >
                    <ExternalLink className="size-3.5 shrink-0" />
                    <span className="truncate">{link.title}</span>
                    <ArrowUpRight className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
          {stats ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="size-3.5 shrink-0" />
                <span>
                  <span className="font-semibold text-foreground">
                    {stats.totalSources}
                  </span>{" "}
                  {t("workspaces.sourcesCount", { count: stats.totalSources })}
                </span>
              </span>
              {stats.failingSources > 0 && (
                <span className="flex items-center gap-1 rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-destructive">
                  <TriangleAlert className="size-3 shrink-0" />
                  {t("workspaces.failingCount", {
                    count: stats.failingSources,
                  })}
                </span>
              )}
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors group-hover:text-foreground">
            {t("common.open")} <ArrowRight className="size-3.5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
