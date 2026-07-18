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
  Terminal,
  Settings,
  Bot,
  type LucideIcon,
} from "lucide-react";

export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const mainNavigation: { title: string; href: string; icon: LucideIcon }[] = [
    { title: t("nav.overview"), href: "/discovery", icon: LayoutDashboard },
    { title: t("nav.findings"), href: "/findings", icon: SearchCheck },
    { title: t("nav.assets"), href: "/assets", icon: FileText },
    { title: t("nav.sources"), href: "/sources", icon: Database },
    { title: t("nav.detectors"), href: "/detectors", icon: FlaskConical },
    { title: t("nav.investigations"), href: "/investigations", icon: Search },
    { title: t("nav.fingerprints"), href: "/fingerprints", icon: Fingerprint },
    { title: t("nav.glossary"), href: "/glossary", icon: BookOpen },
  ];

  const operationsNavigation: { title: string; href: string; icon: LucideIcon }[] = [
    { title: t("nav.scans"), href: "/scans", icon: ScanSearch },
    { title: t("nav.sandbox"), href: "/sandbox", icon: Terminal },
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
                        <item.icon className="size-5" />
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
                        <item.icon className="size-5" />
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
          <AiHealthSidebarWarning />
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={
                pathname === "/harness" || pathname.startsWith("/harness/")
              }
              tooltip={t("nav.harness")}
            >
              <Link href="/harness">
                <Bot className="size-6 text-[#d97706]" />
                <span>{t("nav.harness")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/settings" || pathname.startsWith("/settings/")}
              tooltip={t("nav.settings")}
            >
              <Link href="/settings">
                <Settings className="size-6" />
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
