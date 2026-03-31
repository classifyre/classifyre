"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Shield,
  ScanSearch,
  Settings,
  AlertTriangle,
  FileText,
  FlaskConical,
  Layers,
} from "lucide-react";
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
import { softwareVersionLabel } from "@workspace/ui/lib/software-version";
import { useTranslation } from "@/hooks/use-translation";

export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const mainNavigation = [
    { title: t("nav.overview"), href: "/discovery", icon: LayoutDashboard },
    { title: t("nav.findings"), href: "/findings", icon: AlertTriangle },
    { title: t("nav.assets"), href: "/assets", icon: FileText },
    { title: t("nav.sources"), href: "/sources", icon: Database },
    { title: t("nav.detectors"), href: "/detectors", icon: FlaskConical },
    { title: t("nav.semantic"), href: "/semantic", icon: Layers },
  ];

  const operationsNavigation = [
    { title: t("nav.scans"), href: "/scans", icon: ScanSearch },
    { title: t("nav.sandbox"), href: "/sandbox", icon: FlaskConical },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Shield className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-serif font-bold">{t("app.name")}</span>
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
                        <item.icon className="h-4 w-4" />
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
                        <item.icon className="h-4 w-4" />
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
                <Settings className="h-4 w-4" />
                <span>{t("nav.settings")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pb-2">
          <div className="px-2 py-2 text-xs">
            <span className="font-mono text-sidebar-foreground">{t("common.version")}</span>
            <span className="ml-2 font-mono text-sidebar-foreground">
              {softwareVersionLabel}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
