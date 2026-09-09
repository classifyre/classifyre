"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespaceCategories } from "@/hooks/use-namespace-categories";
import { useLocalePath } from "@/lib/app-path";
import type { TranslationKey } from "@/i18n";
import { VersionSidebarNotifier } from "./version-update-notifier";
import { AiHealthSidebarWarning } from "./ai-health";
import {
  LayoutDashboard,
  SearchCheck,
  FileText,
  Database,
  FlaskConical,
  Search,
  Fingerprint,
  BookOpen,
  ScanSearch,
  Bot,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";

type NavItem = { titleKey: TranslationKey; href: string; icon: LucideIcon };
type NavGroup = { labelKey: TranslationKey; items: NavItem[] };

// Grouped by what the operator is doing, not by data model:
//   Intelligence — what the platform found for you.
//   Casework     — what you are actively working on.
//   Pipeline     — what feeds and shapes the two above.
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.group.intelligence",
    items: [
      { titleKey: "nav.overview", href: "/discovery", icon: LayoutDashboard },
      { titleKey: "nav.findings", href: "/findings", icon: SearchCheck },
      { titleKey: "nav.assets", href: "/assets", icon: FileText },
    ],
  },
  {
    labelKey: "nav.group.casework",
    items: [
      {
        titleKey: "nav.investigations",
        href: "/investigations",
        icon: Search,
      },
      {
        titleKey: "nav.fingerprints",
        href: "/duplicates",
        icon: Fingerprint,
      },
    ],
  },
  {
    labelKey: "nav.group.pipeline",
    items: [
      { titleKey: "nav.sources", href: "/sources", icon: Database },
      { titleKey: "nav.detectors", href: "/detectors", icon: FlaskConical },
      { titleKey: "nav.glossary", href: "/glossary", icon: BookOpen },
      { titleKey: "nav.scans", href: "/scans", icon: ScanSearch },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { nsHref, displayName, namespace, slug } = useNamespace();
  const localePath = useLocalePath();
  const { categories } = useNamespaceCategories();
  // The categories this workspace is filed under, in the registry's own
  // (alphabetical) order. Empty only while the two requests are in flight —
  // a workspace always belongs to at least one.
  const filedUnder = React.useMemo(
    () =>
      namespace
        ? categories.filter((category) =>
            namespace.categoryIds.includes(category.id),
          )
        : [],
    [categories, namespace],
  );
  const primaryCategory = filedUnder[0];
  const isActivePath = (href: string) => {
    const full = nsHref(href);
    return pathname === full || pathname.startsWith(full + "/");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              {/* A div, not a Link: the caption underneath is itself a link and
                  an anchor cannot be nested inside another anchor. The header
                  keeps its own layout and styling either way. */}
              <div>
                <Link
                  href={nsHref("/")}
                  aria-label={displayName}
                  className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg"
                >
                  <Image
                    src="/clasifyre_icon.png"
                    width={32}
                    height={32}
                    alt="Classifyre"
                    className="size-full object-cover"
                  />
                </Link>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <Link
                    href={nsHref("/")}
                    className="truncate font-serif font-bold"
                  >
                    {displayName}
                  </Link>
                  {primaryCategory ? (
                    // Same caption slot the workspace path used to occupy —
                    // where the workspace is filed says more than a URL the
                    // address bar already shows.
                    <span className="truncate text-xs text-muted-foreground">
                      <Link
                        href={localePath(
                          `/namespaces/categories/${primaryCategory.id}`,
                        )}
                        title={t("categories.viewAria", {
                          title: primaryCategory.title,
                        })}
                        className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
                      >
                        {primaryCategory.title}
                      </Link>
                      {filedUnder.length > 1 && (
                        // Only the first one fits; the rest are one click away
                        // on the category page itself.
                        <span title={filedUnder.map((c) => c.title).join(", ")}>
                          {" "}
                          +{filedUnder.length - 1}
                        </span>
                      )}
                    </span>
                  ) : (
                    // Until the registry answers, the route slug is the only
                    // thing known about this workspace.
                    <span className="truncate text-xs text-muted-foreground">
                      /{slug}
                    </span>
                  )}
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
              {t(group.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const title = t(item.titleKey);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActivePath(item.href)}
                        tooltip={title}
                      >
                        <Link href={nsHref(item.href)}>
                          <item.icon className="size-5" />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <AiHealthSidebarWarning />
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActivePath("/harness")}
              tooltip={t("nav.harness")}
            >
              <Link href={nsHref("/harness")}>
                <Bot className="size-6 text-[#d97706]" />
                <span>{t("nav.harness")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          {/* Leaving the workspace is the last thing on the rail — a way out,
              not a destination competing with the navigation above. */}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("workspaces.all")}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <Link href="/">
                <ArrowLeft className="size-5" />
                <span>{t("workspaces.all")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pb-2">
          <VersionSidebarNotifier />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
