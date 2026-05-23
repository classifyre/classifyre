"use client";

import * as React from "react";
import { AppSidebar } from "./app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { Separator } from "@workspace/ui/components/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { NotificationCenter } from "./notification-center";
import { Button } from "@workspace/ui/components/button";
import { Eye, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { api } from "@workspace/api-client";
import { ThemeToggle } from "./theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { AssistantWorkflowTrigger } from "./assistant-workflow-provider";
import { useInstanceSettings } from "./instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

function formatSegmentLabel(
  segment: string,
  segmentLabelMap: Record<string, string>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  previousSegment?: string,
) {
  if (segmentLabelMap[segment]) {
    return segmentLabelMap[segment];
  }

  const looksLikeId = segment.length >= 8 && /^[a-zA-Z0-9-]+$/.test(segment);
  if (looksLikeId) {
    const id = segment.slice(0, 8);
    if (previousSegment === "scans") return t("breadcrumb.run", { id });
    if (previousSegment === "sources") return t("breadcrumb.source", { id });
    if (previousSegment === "assets") return t("breadcrumb.asset", { id });
    if (previousSegment === "findings") return t("breadcrumb.finding", { id });
    return id;
  }

  return decodeURIComponent(segment)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isDynamicSegment(segment: string) {
  return segment.length >= 8 && /^[a-zA-Z0-9-]+$/.test(segment);
}

function shouldUseTooltip(label: string) {
  return label.length > 24;
}

type BreadcrumbEntry = {
  href: string;
  label: string;
  isCurrent: boolean;
  alwaysVisible?: boolean;
};

type FindingAssetCrumb = {
  href: string;
  label: string;
};

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();

  const segmentLabelMap: Record<string, string> = {
    dashboard: t("breadcrumb.dashboard"),
    discovery: t("breadcrumb.discovery"),
    findings: t("breadcrumb.findings"),
    scans: t("breadcrumb.scans"),
    sources: t("breadcrumb.sources"),
    assets: t("breadcrumb.assets"),
    notifications: t("breadcrumb.notifications"),
    settings: t("breadcrumb.settings"),
    detectors: t("breadcrumb.detectors"),
    sandbox: t("breadcrumb.sandbox"),
    semantic: t("breadcrumb.semantic"),
  };

  const [resolvedDynamicLabels, setResolvedDynamicLabels] = React.useState<
    Record<string, string>
  >({});
  const [findingAssetCrumbs, setFindingAssetCrumbs] = React.useState<
    Record<string, FindingAssetCrumb>
  >({});
  const segments = React.useMemo(
    () => pathname.split("/").filter(Boolean),
    [pathname],
  );

  React.useEffect(() => {
    let isMounted = true;

    const resolveDynamicLabels = async () => {
      const labelUpdates: Record<string, string> = {};
      const findingAssetUpdates: Record<string, FindingAssetCrumb> = {};

      await Promise.all(
        segments.map(async (segment, index) => {
          const previousSegment = segments[index - 1];
          if (!previousSegment || !isDynamicSegment(segment)) {
            return;
          }

          const cacheKey = `${previousSegment}:${segment}`;
          const hasCachedLabel = Boolean(resolvedDynamicLabels[cacheKey]);
          const hasCachedFindingAsset =
            previousSegment !== "findings" ||
            Boolean(findingAssetCrumbs[segment]);
          if (hasCachedLabel && hasCachedFindingAsset) {
            return;
          }

          try {
            if (previousSegment === "assets") {
              const response = await api.assets.assetsControllerGetAsset({
                id: segment,
              });
              const label =
                response.name?.trim() || response.externalUrl?.trim();
              if (label) {
                labelUpdates[cacheKey] = label;
              }
              return;
            }

            if (previousSegment === "sources") {
              const response = await api.sources.sourcesControllerGetSource({
                id: segment,
              });
              const label = response.name?.trim();
              if (label) {
                labelUpdates[cacheKey] = label;
              }
              return;
            }

            if (previousSegment === "findings") {
              const response = await api.findings.findingsControllerFindOne({
                id: segment,
              });
              const label =
                response.findingType?.trim() ||
                `Finding ${segment.slice(0, 8)}`;
              labelUpdates[cacheKey] = label;

              const assetId = response.asset?.id || response.assetId;
              if (assetId) {
                const assetLabel =
                  response.asset?.name?.trim() ||
                  response.asset?.externalUrl?.trim() ||
                  `Asset ${assetId.slice(0, 8)}`;
                findingAssetUpdates[segment] = {
                  href: `/assets/${assetId}`,
                  label: assetLabel,
                };
              }
            }
          } catch {
            // Keep fallback URL-derived labels for unresolved entities.
          }
        }),
      );

      if (!isMounted) {
        return;
      }

      if (Object.keys(labelUpdates).length > 0) {
        setResolvedDynamicLabels((current) => ({
          ...current,
          ...labelUpdates,
        }));
      }

      if (Object.keys(findingAssetUpdates).length > 0) {
        setFindingAssetCrumbs((current) => ({
          ...current,
          ...findingAssetUpdates,
        }));
      }
    };

    resolveDynamicLabels();

    return () => {
      isMounted = false;
    };
  }, [findingAssetCrumbs, resolvedDynamicLabels, segments]);

  const breadcrumbs = React.useMemo<BreadcrumbEntry[]>(() => {
    const baseCrumbs = segments.map((segment, index) => ({
      href: `/${segments.slice(0, index + 1).join("/")}`,
      label:
        resolvedDynamicLabels[`${segments[index - 1]}:${segment}`] ||
        formatSegmentLabel(segment, segmentLabelMap, t, segments[index - 1]),
      isCurrent: index === segments.length - 1,
    }));

    const findingId =
      segments[0] === "findings" && isDynamicSegment(segments[1] || "")
        ? segments[1]
        : null;

    if (!findingId) {
      return baseCrumbs;
    }

    const assetCrumb = findingAssetCrumbs[findingId];
    if (!assetCrumb) {
      return baseCrumbs;
    }

    return baseCrumbs.flatMap((crumb, index) =>
      index === 1
        ? [
            {
              href: assetCrumb.href,
              label: assetCrumb.label,
              isCurrent: false,
              alwaysVisible: true,
            },
            crumb,
          ]
        : [crumb],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingAssetCrumbs, resolvedDynamicLabels, segments, t]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-x-clip">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href="/">{t("breadcrumb.home")}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {breadcrumbs.map((crumb) => (
                  <React.Fragment key={crumb.href}>
                    <BreadcrumbSeparator
                      className={
                        crumb.alwaysVisible || crumb.isCurrent
                          ? ""
                          : "hidden sm:block"
                      }
                    />
                    <BreadcrumbItem
                      className={
                        crumb.isCurrent || crumb.alwaysVisible
                          ? ""
                          : "hidden sm:inline-flex"
                      }
                    >
                      {crumb.isCurrent ? (
                        shouldUseTooltip(crumb.label) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <BreadcrumbPage className="max-w-[220px] truncate">
                                {crumb.label}
                              </BreadcrumbPage>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={6}>
                              {crumb.label}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <BreadcrumbPage className="max-w-[220px] truncate">
                            {crumb.label}
                          </BreadcrumbPage>
                        )
                      ) : shouldUseTooltip(crumb.label) ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <BreadcrumbLink asChild>
                              <Link
                                href={crumb.href}
                                className="inline-block max-w-[180px] truncate"
                              >
                                {crumb.label}
                              </Link>
                            </BreadcrumbLink>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {crumb.label}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link href={crumb.href}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-2">
            {settings.demoMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex cursor-default items-center gap-1.5 rounded-[4px] border border-amber-600/40 bg-amber-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400">
                    <Eye className="h-3 w-3" />
                    {t("demo.badge")}
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  className="max-w-xs"
                >
                  {t("demo.tooltip")}
                </TooltipContent>
              </Tooltip>
            )}
            <AssistantWorkflowTrigger />
            <ThemeToggle />
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="relative rounded-[4px] border-2 border-transparent hover:border-border"
            >
              <Link href="/settings">
                <Settings className="h-5 w-5" />
                <span className="sr-only">Settings</span>
              </Link>
            </Button>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-2">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
