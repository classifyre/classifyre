import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Bot,
  Database,
  FileText,
  Fingerprint,
  FlaskConical,
  Globe,
  LayoutDashboard,
  PanelLeft,
  ScanSearch,
  Search,
  SearchCheck,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Img } from "remotion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import logo from "../../../web/public/clasifyre_icon.png";
import { webText } from "../borrow/web-translation";

/*
 * The app as it stands round every page: its sidebar and its header, put
 * together from the same @workspace/ui parts and the same English dictionary
 * as apps/web/components/app-sidebar.tsx and dashboard-layout.tsx. Those two
 * files cannot be filmed themselves: they ask the router where they are and
 * the API which workspace this is.
 *
 * Imported by path (`src/kit/app-shell`), not from the kit's index: it pulls
 * in the app's dictionary, which a video that never opens the app has no use
 * for.
 */

/** The app's own English wording for a key. */
export const T = webText;

/** The browser window every in-app scene uses, and how much the page is magnified in it. */
export const BROWSER = { x: 70, y: 50, w: 1780, h: 900 } as const;
export const ZOOM = 1.2;
/** The page's own size inside that window. */
export const PAGE = {
  w: BROWSER.w / ZOOM,
  h: (BROWSER.h - 52) / ZOOM,
} as const;

export type Section =
  | "discovery"
  | "findings"
  | "assets"
  | "investigations"
  | "duplicates"
  | "sources"
  | "detectors"
  | "glossary"
  | "scans";

const NAV: {
  label: string;
  items: { id: Section; title: string; icon: LucideIcon }[];
}[] = [
  {
    label: T("nav.group.intelligence"),
    items: [
      { id: "discovery", title: T("nav.overview"), icon: LayoutDashboard },
      { id: "findings", title: T("nav.findings"), icon: SearchCheck },
      { id: "assets", title: T("nav.assets"), icon: FileText },
    ],
  },
  {
    label: T("nav.group.casework"),
    items: [
      { id: "investigations", title: T("nav.investigations"), icon: Search },
      { id: "duplicates", title: T("nav.fingerprints"), icon: Fingerprint },
    ],
  },
  {
    label: T("nav.group.pipeline"),
    items: [
      { id: "sources", title: T("nav.sources"), icon: Database },
      { id: "detectors", title: T("nav.detectors"), icon: FlaskConical },
      { id: "glossary", title: T("nav.glossary"), icon: BookOpen },
      { id: "scans", title: T("nav.scans"), icon: ScanSearch },
    ],
  },
];

const iconButton = "relative rounded-[4px] border-2 border-transparent";

function AppHeader({
  crumbs,
  notifications,
  trigger = false,
}: {
  crumbs: string[];
  notifications: number;
  /** The sidebar's own toggle, which needs the sidebar to be there. */
  trigger?: boolean;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        {trigger ? (
          <SidebarTrigger className="-ml-1 size-7 shrink-0" />
        ) : (
          <PanelLeft className="-ml-1 size-4 shrink-0" />
        )}
        <Separator orientation="vertical" className="mr-2 h-4 shrink-0" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>Home</BreadcrumbItem>
            {crumbs.map((crumb, index) => (
              <span key={crumb} className="contents">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {index === crumbs.length - 1 ? (
                    <BreadcrumbPage>{crumb}</BreadcrumbPage>
                  ) : (
                    crumb
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {[Globe, Sun].map((Glyph, index) => (
          <Button
            key={index}
            variant="ghost"
            size="icon"
            className={iconButton}
          >
            <Glyph className="h-5 w-5" />
          </Button>
        ))}
        <Button variant="ghost" size="icon" className={iconButton}>
          <Bell className="h-5 w-5" />
          {notifications > 0 && (
            <span className="absolute -right-1.5 -top-1.5 rounded-[3px] bg-accent px-1 font-mono text-[10px] font-bold leading-4 text-black">
              {notifications}
            </span>
          )}
        </Button>
        {[BookOpen, Settings].map((Glyph, index) => (
          <Button
            key={index}
            variant="ghost"
            size="icon"
            className={iconButton}
          >
            <Glyph className="h-5 w-5" />
          </Button>
        ))}
      </div>
    </header>
  );
}

export function AppShell({
  workspace,
  category = "General",
  active,
  crumbs,
  scroll = 0,
  notifications = 0,
  overlay,
  rail = false,
  children,
}: {
  /** The workspace's name, as the sidebar heads itself. */
  workspace: string;
  /** The category it is filed under: the line beneath its name. */
  category?: string;
  active: Section;
  /** The trail after "Home"; the last one is the page. */
  crumbs: string[];
  /** How far the page is scrolled. The sidebar stays. */
  scroll?: number;
  notifications?: number;
  /** What stays at the foot of the page while it scrolls: a form's action bar. */
  overlay?: ReactNode;
  /** The sidebar folded to its icons, as on a page that wants the room: a case board. */
  rail?: boolean;
  children: ReactNode;
}) {
  if (rail) {
    return (
      <div className="flex" style={{ height: PAGE.h }}>
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground">
          <Img src={logo} className="mb-3 size-8 rounded-lg" />
          {NAV.flatMap((group) => group.items).map((item) => (
            <span
              key={item.id}
              data-nav={item.id}
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                item.id === active &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-5" />
            </span>
          ))}
          <Bot className="mt-auto size-6 text-[#d97706]" />
        </div>
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <AppHeader crumbs={crumbs} notifications={notifications} />
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-2">
            {children}
          </div>
        </main>
      </div>
    );
  }
  return (
    <SidebarProvider className="h-full min-h-0" style={{ height: PAGE.h }}>
      <Sidebar collapsible="none" className="border-r">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <div>
                  <span className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
                    <Img src={logo} className="size-full object-cover" />
                  </span>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-serif font-bold">
                      {workspace}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {category}
                    </span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton asChild isActive={item.id === active}>
                        <span data-nav={item.id}>
                          <item.icon className="size-5" />
                          <span>{item.title}</span>
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <span>
                  <Bot className="size-6 text-[#d97706]" />
                  <span className="min-w-0 flex-1 truncate">
                    {T("nav.harness")}
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarSeparator className="mx-0" />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="text-sidebar-foreground/70">
                <span>
                  <ArrowLeft className="size-5" />
                  <span>{T("workspaces.all")}</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 overflow-hidden">
        <div style={{ transform: `translateY(${-scroll}px)` }}>
          <AppHeader crumbs={crumbs} notifications={notifications} trigger />
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-2">
            {children}
          </div>
        </div>
        {overlay && (
          <div className="absolute inset-x-4 bottom-2">{overlay}</div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

/** A page heading with its icon, as the list pages have it, and what sits to its right. */
export function PageHead({
  icon: Glyph,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <h1 className="flex items-center gap-3 font-serif text-3xl font-black uppercase tracking-[0.08em]">
        {Glyph && <Glyph className="size-7" />}
        {title}
      </h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** One of the figures across the top of a list page. */
export function Figure({
  label,
  value,
  note,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[6px] border-2 border-border bg-card p-4",
        className,
      )}
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-1 font-serif text-3xl font-black tabular-nums"
        style={{ color: tone }}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A filter that is not open: the look of a closed select. */
export function Chooser({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-9 items-center justify-between gap-3 rounded-[4px] border-2 border-border bg-background px-3 text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
      <svg
        viewBox="0 0 24 24"
        className="size-4 opacity-60"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
