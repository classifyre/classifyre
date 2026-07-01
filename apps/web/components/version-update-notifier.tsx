"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles, Tag } from "lucide-react";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components";
import {
  softwareVersion,
  softwareVersionLabel,
} from "@workspace/ui/lib/software-version";
import { useTranslation } from "@/hooks/use-translation";

interface GithubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
}

function isNewerVersion(current: string, latest: string): boolean {
  const normalize = (v: string) => v.replace(/^v/, "");
  const toNumbers = (v: string) => normalize(v).split(".").map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = toNumbers(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = toNumbers(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

function useVersionCheck() {
  const [release, setRelease] = useState<GithubRelease | null>(null);

  useEffect(() => {
    async function checkLatestRelease() {
      try {
        const response = await fetch(
          "https://api.github.com/repos/classifyre/classifyre/releases/latest",
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as GithubRelease;
        if (isNewerVersion(softwareVersion, data.tag_name)) {
          setRelease(data);
        }
      } catch {
        // non-critical — fail silently
      }
    }
    void checkLatestRelease();
  }, []);

  return release;
}

/** Compact sidebar trigger — only renders when an update is available */
export function VersionSidebarNotifier() {
  const { t } = useTranslation();
  const release = useVersionCheck();
  const [open, setOpen] = useState(false);

  if (!release) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="font-mono text-[11px] text-sidebar-foreground">
            {t("settings.version.updateAvailable")}
          </span>
          <Badge className="ml-auto rounded-[3px] border border-border bg-accent px-1.5 py-0.5 text-[10px] font-mono text-accent-foreground">
            {release.tag_name}
          </Badge>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        className="w-72 rounded-[6px] border-2 border-border bg-card p-0 shadow-[4px_4px_0_var(--color-border)]"
      >
        <div className="border-b-2 border-border bg-foreground px-4 py-3 text-primary-foreground">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary-foreground/70">
            {t("settings.version.newRelease")}
          </p>
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">
            {release.name || release.tag_name}
          </h3>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("settings.version.current")}
            </span>
            <span className="font-mono text-xs">{softwareVersionLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("settings.version.latest")}
            </span>
            <Badge className="rounded-[3px] border border-border bg-accent px-2 py-0.5 text-[10px] font-mono text-accent-foreground">
              {release.tag_name}
            </Badge>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-1 w-full border-2 border-border"
          >
            <a href={release.html_url} target="_blank" rel="noreferrer">
              {t("settings.version.viewReleaseNotes")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Inline settings card — always shows current version, expands with update info when available */
export function VersionSettingsSection() {
  const { t } = useTranslation();
  const release = useVersionCheck();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4" />
        <p className="font-mono text-xs uppercase tracking-[0.14em]">
          {t("settings.version.heading")}
        </p>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        {t("settings.version.desc")}
      </p>

      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {t("settings.version.current")}
        </span>
        <span className="font-mono text-sm font-medium text-foreground">
          {softwareVersionLabel}
        </span>
        {!release && (
          <Badge
            variant="outline"
            className="rounded-[3px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
          >
            {t("settings.version.upToDate")}
          </Badge>
        )}
      </div>

      {release && (
        <div className="rounded-[4px] border-2 border-accent bg-muted p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
                  {t("settings.version.updateAvailable")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.version.updateDesc")}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("settings.version.latest")}
                </span>
                <Badge className="rounded-[3px] border border-border bg-accent px-2 py-0.5 font-mono text-[10px] text-accent-foreground">
                  {release.tag_name}
                </Badge>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full border-2 border-border"
              >
                <a href={release.html_url} target="_blank" rel="noreferrer">
                  {t("settings.version.viewReleaseNotes")}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
