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
        href: "/fingerprints",
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
  const { nsHref, displayName, slug } = useNamespace();
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
              <Link href={nsHref("/")}>
                <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
                  <Image
                    src="/clasifyre_icon.png"
                    width={32}
                    height={32}
                    alt="Classifyre"
                    className="size-full object-cover"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-serif font-bold">
                    {displayName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    /{slug}
                  </span>
                </div>
              </Link>
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
