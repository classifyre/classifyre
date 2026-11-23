"use client";

import * as React from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { copyText } from "@/lib/data-query";

export interface WorkbenchSubtabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  testId?: string;
  content: React.ReactNode;
}

/**
 * Shared DBeaver/Navicat-style object tab shell used by both Source (database)
 * and Asset (table) tabs inside the SQL workbench: a compact pinned header,
 * a line-style subtab bar right underneath, and an independently scrollable
 * content pane so neither the main tab strip nor the page ever scrolls away.
 */
export function WorkbenchObjectShell({
  icon,
  title,
  titleHref,
  titleHint,
  copyHint,
  subtitle,
  sqlName,
  badges,
  actions,
  tabs,
  activeTab,
  onTabChange,
  testId,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  /** The object's own page; the title opens it in a new browser tab. */
  titleHref?: string;
  /** Tooltip on the title link. */
  titleHint?: string;
  /** Tooltip on the copy button beside the title (copies `sqlName`). */
  copyHint?: string;
  subtitle?: React.ReactNode;
  sqlName?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  tabs: WorkbenchSubtabItem[];
  activeTab: string;
  onTabChange: (next: string) => void;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  const handleCopySqlName = React.useCallback(() => {
    if (!sqlName) return;
    void copyText(sqlName).then((ok) => {
      if (ok) toast.success(t("dataQuery.explorer.copied", { name: sqlName }));
    });
  }, [sqlName, t]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
          className,
        )}
        data-testid={testId}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b bg-muted/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex shrink-0 items-center" aria-hidden="true">
              {icon}
            </span>
            {titleHref ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={titleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-semibold tracking-tight underline-offset-4 hover:underline"
                    data-testid="object-title-link"
                  >
                    <h2 className="inline">{title}</h2>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {titleHint ?? title}
                </TooltipContent>
              </Tooltip>
            ) : (
              <h2
                className="truncate text-sm font-semibold tracking-tight"
                title={title}
              >
                {title}
              </h2>
            )}
            {sqlName && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCopySqlName}
                    aria-label={
                      copyHint ??
                      t("dataQuery.explorer.copyNameHint", { name: sqlName })
                    }
                    className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    data-testid="object-copy-name"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="font-mono text-xs">
                  {copyHint ??
                    t("dataQuery.explorer.copyNameHint", { name: sqlName })}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {badges && (
            <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
          )}

          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}

          {actions && (
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
              {actions}
            </div>
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={onTabChange}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          <div className="shrink-0 overflow-x-auto border-b bg-background px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList
              variant="line"
              className="h-9 w-max justify-start gap-1 rounded-none bg-transparent p-0"
            >
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  data-testid={tab.testId}
                  className="h-9 flex-none gap-1.5 rounded-none px-2.5 text-xs after:bottom-0"
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.badge}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {tabs.map((tab) => (
            <TabsContent
              key={tab.value}
              value={tab.value}
              className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 data-[state=inactive]:hidden"
            >
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
