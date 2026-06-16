"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
} from "@workspace/ui/components/sidebar";
import { useTranslation } from "@/hooks/use-translation";
import { VersionSidebarNotifier } from "./version-update-notifier";
import { AppIcon, type IconName } from "./app-icon";

export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const mainNavigation: { title: string; href: string; iconName: IconName }[] = [
    { title: t("nav.overview"), href: "/discovery", iconName: "people" },
    { title: t("nav.findings"), href: "/findings", iconName: "finger-print" },
    { title: t("nav.assets"), href: "/assets", iconName: "docs" },
    { title: t("nav.sources"), href: "/sources", iconName: "binders" },
    { title: t("nav.detectors"), href: "/detectors", iconName: "single-probe" },
    { title: t("nav.investigations"), href: "/investigations", iconName: "dna" },
    { title: t("nav.fingerprints"), href: "/fingerprints", iconName: "feet" },
  ];

  const operationsNavigation: { title: string; href: string; iconName: IconName }[] = [
    { title: t("nav.scans"), href: "/scans", iconName: "check-list" },
    { title: t("nav.sandbox"), href: "/sandbox", iconName: "probe" },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
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
                    {t("app.name")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("app.tagline")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <AppIcon name={item.iconName} active={isActive} size={20} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.operations")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsNavigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <AppIcon name={item.iconName} active={isActive} size={20} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("nav.settings")}>
              <Link href="/settings">
                <AppIcon name="settings" size={24} />
                <span>{t("nav.settings")}</span>
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
