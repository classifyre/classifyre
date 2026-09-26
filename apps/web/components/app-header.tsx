"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { BookOpen, Globe, Home, Moon, MoreVertical, Settings, Sun } from "lucide-react";
import { api } from "@workspace/api-client";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { stripLocalePrefix } from "@/lib/locale-detection";
import { useEntityName } from "./document-title-updater";
import { LANGUAGE_OPTIONS, LanguageSwitcher, useSwitchLanguage } from "./language-switcher";
import { NotificationCenter } from "./notification-center";
import { ThemeToggle } from "./theme-toggle";
import { DemoModeHeaderBadge } from "./demo-mode-badge";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * A route segment that names a record rather than a page: a UUID, or an id
 * with digits in it. Plain words ("investigations", "inquiries") are pages,
 * however long — treating every 8+ letter segment as an id is what cut
 * "investigations" down to "investig".
 */
export function isIdSegment(segment: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  return segment.length >= 8 && /^[a-zA-Z0-9_-]+$/.test(segment) && /\d/.test(segment);
}

/** The label of a page segment; the record a segment names is labelled elsewhere. */
function pageLabel(segment: string, previous: string | undefined, t: T): string {
  const labels: Record<string, string> = {
    dashboard: t("breadcrumb.dashboard"),
    discovery: t("breadcrumb.discovery"),
    findings: t("breadcrumb.findings"),
    scans: t("breadcrumb.scans"),
    sources: t("breadcrumb.sources"),
    assets: t("breadcrumb.assets"),
    notifications: t("breadcrumb.notifications"),
    settings: t("breadcrumb.settings"),
    detectors: t("breadcrumb.detectors"),
    harness: t("nav.harness"),
    providers: t("breadcrumb.aiProviders"),
    edit: t("breadcrumb.edit"),
    investigations: t("nav.investigations"),
    inquiries: t("investigations.page.tabInquiries"),
    cases: t("investigations.page.tabCases"),
    evidence: t("breadcrumb.evidence"),
    add: t("breadcrumb.add"),
    duplicates: t("nav.fingerprints"),
    glossary: t("glossary.title"),
  };
  if (segment === "new") {
    if (previous === "providers") return t("breadcrumb.newProvider");
    if (previous === "inquiries") return t("investigations.page.newInquiry");
    if (previous === "cases") return t("investigations.page.newCase");
    return t("breadcrumb.new");
  }
  if (labels[segment]) return labels[segment];
  if (isIdSegment(segment)) {
    const id = segment.slice(0, 8);
    if (previous === "scans") return t("breadcrumb.run", { id });
    if (previous === "sources") return t("breadcrumb.source", { id });
    if (previous === "assets") return t("breadcrumb.asset", { id });
    if (previous === "findings") return t("breadcrumb.finding", { id });
    return id;
  }
  return decodeURIComponent(segment)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Where a crumb links to. A few segments have no page of their own — the
 * watch and case lists live on the investigations page's tabs, a case's
 * evidence on the case — so they point at the page that shows them.
 */
function crumbPath(segments: string[], index: number): string {
  const path = `/${segments.slice(0, index + 1).join("/")}`;
  if (segments[0] === "investigations") {
    if (index === 1 && segments[1] === "inquiries") return "/investigations?tab=inquiries";
    if (index === 1 && segments[1] === "cases") return "/investigations";
    if (index === 2 && segments[2] === "evidence") return `/investigations/${segments[1]}`;
  }
  return path;
}

export interface Crumb {
  href: string;
  label: string;
  isCurrent: boolean;
  alwaysVisible?: boolean;
}

/** Names for the records the path points at, fetched once per record. */
function useRecordLabels(segments: string[], nsHref: (path: string) => string) {
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const [findingAssets, setFindingAssets] = React.useState<Record<string, { href: string; label: string }>>({});
  const asked = React.useRef(new Set<string>());

  React.useEffect(() => {
    let alive = true;
    segments.forEach((segment, index) => {
      const previous = segments[index - 1];
      if (!previous || !isIdSegment(segment)) return;
      const key = `${previous}:${segment}`;
      if (asked.current.has(key)) return;
      asked.current.add(key);
      const set = (label: string | null | undefined) => {
        const value = label?.trim();
        if (alive && value) setLabels((current) => ({ ...current, [key]: value }));
      };
      const lookup = async () => {
        if (previous === "assets") {
          const a = await api.assets.assetsControllerGetAsset({ id: segment });
          set(a.name || a.externalUrl);
        } else if (previous === "sources") {
          set((await api.sources.sourcesControllerGetSource({ id: segment })).name);
        } else if (previous === "providers") {
          set((await api.aiProviderConfigs.aiProviderConfigControllerGet({ id: segment })).name);
        } else if (previous === "investigations") {
          set((await api.cases.casesControllerFindOne({ id: segment })).title);
        } else if (previous === "inquiries") {
          set((await api.inquiries.inquiriesControllerFindOne({ id: segment })).title);
        } else if (previous === "findings") {
          const f = await api.findings.findingsControllerFindOne({ id: segment });
          set(f.findingType || `Finding ${segment.slice(0, 8)}`);
          const assetId = f.asset?.id || f.assetId;
          if (assetId && alive) {
            setFindingAssets((current) => ({
              ...current,
              [segment]: {
                href: nsHref(`/assets/${assetId}`),
                label: f.asset?.name?.trim() || f.asset?.externalUrl?.trim() || `Asset ${assetId.slice(0, 8)}`,
              },
            }));
          }
        }
      };
      // An unresolvable record keeps its short id.
      lookup().catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, [segments, nsHref]);

  return { labels, findingAssets };
}

function CrumbLabel({ label, current }: { label: string; current: boolean }) {
  const text = current ? (
    <BreadcrumbPage className="block max-w-[min(46vw,280px)] truncate">{label}</BreadcrumbPage>
  ) : (
    <span className="block max-w-[180px] truncate">{label}</span>
  );
  if (label.length <= 24) return text;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-sm">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The app header's trail: Home › page › record, every page segment in its
 * full translated name and every record by its own name (the page's, when it
 * announced one). On a phone the middle folds into "…", which opens it.
 */
export function AppBreadcrumbs() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const entityName = useEntityName();
  const segments = React.useMemo(
    () => stripLocalePrefix(pathname).rest.split("/").filter(Boolean).slice(1),
    [pathname],
  );
  const { labels, findingAssets } = useRecordLabels(segments, nsHref);

  const crumbs = React.useMemo<Crumb[]>(() => {
    const last = segments.length - 1;
    const base: Crumb[] = segments.map((segment, index) => {
      const previous = segments[index - 1];
      const recordName =
        index === last && isIdSegment(segment) && entityName ? entityName : labels[`${previous}:${segment}`];
      return {
        href: nsHref(crumbPath(segments, index)),
        label: recordName || pageLabel(segment, previous, t),
        isCurrent: index === last,
      };
    });
    const findingId = segments[0] === "findings" && isIdSegment(segments[1] ?? "") ? segments[1]! : null;
    const asset = findingId ? findingAssets[findingId] : undefined;
    if (!asset) return base;
    return base.flatMap((crumb, index) =>
      index === 1 ? [{ href: asset.href, label: asset.label, isCurrent: false, alwaysVisible: true }, crumb] : [crumb],
    );
  }, [segments, labels, findingAssets, entityName, nsHref, t]);

  const middle = crumbs.filter((c) => !c.isCurrent && !c.alwaysVisible);

  return (
    <Breadcrumb className="min-w-0">
      {/* Nowrap: a squeezed header truncates the trail instead of wrapping it. */}
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={nsHref("/")} className="inline-flex items-center gap-1">
              <Home className="size-4 sm:hidden" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("breadcrumb.home")}</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {/* Phones: the middle of the trail behind "…". */}
        {middle.length > 0 && (
          <>
            <BreadcrumbSeparator className="sm:hidden" />
            <BreadcrumbItem className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-[4px] hover:bg-muted" aria-label={t("breadcrumb.showPath")}>
                  <BreadcrumbEllipsis className="size-7" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-[80vw]">
                  {middle.map((crumb) => (
                    <DropdownMenuItem key={crumb.href} asChild>
                      <Link href={crumb.href} className="block truncate">
                        {crumb.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}
        {crumbs.map((crumb) => {
          const always = crumb.isCurrent || crumb.alwaysVisible;
          return (
            <React.Fragment key={`${crumb.href}|${crumb.label}`}>
              <BreadcrumbSeparator className={cn(!always && "hidden sm:block")} />
              <BreadcrumbItem className={cn("min-w-0", !always && "hidden sm:inline-flex")}>
                {crumb.isCurrent ? (
                  <CrumbLabel label={crumb.label} current />
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href} className="min-w-0">
                      <CrumbLabel label={crumb.label} current={false} />
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

const iconButton = "relative rounded-[4px] border-2 border-transparent hover:border-border";

/**
 * The header's tools. On a phone only notifications stay out; language,
 * theme, the documentation and settings move into one menu, so the trail
 * keeps the room.
 */
export function HeaderActions({ demoMode }: { demoMode: boolean }) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const { resolvedTheme, setTheme } = useTheme();
  const { resolvedLanguage, switchLanguage } = useSwitchLanguage();
  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      {demoMode && <DemoModeHeaderBadge />}
      <div className="hidden items-center gap-2 sm:flex">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <NotificationCenter />
      {/*
        A plain <a>, not next/link: the documentation is a separate Next app
        (apps/docs) exported into apps/web/public/docs, so /docs is static
        files rather than a route in this router — a client-side navigation
        there would not resolve.
      */}
      <Button variant="ghost" size="icon" asChild className={cn(iconButton, "hidden sm:inline-flex")}>
        <a href="/docs/" target="_blank" rel="noopener noreferrer">
          <BookOpen className="h-5 w-5" />
          <span className="sr-only">{t("nav.documentation")}</span>
        </a>
      </Button>
      <Button variant="ghost" size="icon" asChild className={cn(iconButton, "hidden sm:inline-flex")}>
        <Link href={nsHref("/settings")}>
          <Settings className="h-5 w-5" />
          <span className="sr-only">{t("breadcrumb.settings")}</span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={cn(iconButton, "sm:hidden")} data-testid="header-more">
            <MoreVertical className="h-5 w-5" />
            <span className="sr-only">{t("common.more")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {t("common.toggleTheme")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Globe className="size-4" /> {t("common.language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={resolvedLanguage} onValueChange={(v) => switchLanguage(v as typeof resolvedLanguage)}>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/docs/" target="_blank" rel="noopener noreferrer">
              <BookOpen className="size-4" /> {t("nav.documentation")}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={nsHref("/settings")}>
              <Settings className="size-4" /> {t("breadcrumb.settings")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
