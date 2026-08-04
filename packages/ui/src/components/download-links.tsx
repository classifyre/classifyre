"use client";

import * as React from "react";

import { Button } from "./button";
import { cn } from "../lib/utils";

import { AppleLogo, LinuxLogo, WindowsLogo } from "./brand-logos";
import {
  formatAssetSize,
  groupByOs,
  pickDownload,
  fetchLatestRelease,
  OS_LABELS,
  type ArchKey,
  type LatestRelease,
  type OsKey,
  type ReleaseDownload,
} from "../lib/releases";
import { releasesLatestUrl } from "../lib/site-links";

/**
 * Download UI that hands over the actual release file instead of the GitHub
 * releases page. The release is resolved at build time by the page (server
 * component) and passed in as `release`; these components refresh it in the
 * browser so a desktop release cut after the last site deploy still wins.
 *
 * Shared by the marketing site (`/download`, landing page) and the docs site
 * (home page, desktop install guide) so both hand out the same artifact for a
 * given platform.
 *
 * Everything degrades to `releasesLatestUrl` (the releases page) when the
 * release can't be resolved at all — offline build plus a rate-limited
 * browser — so a download button is never a dead end.
 */

const OS_LOGOS: Record<OsKey, (props: { className?: string }) => React.JSX.Element> = {
  mac: AppleLogo,
  windows: WindowsLogo,
  linux: LinuxLogo,
};

const SESSION_CACHE_KEY = "classifyre:latest-release";
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * One in-flight refresh per page load, shared by every component on the page:
 * the landing page renders the grid and two buttons, and three parallel calls
 * would burn three of the visitor's 60 anonymous GitHub requests per hour.
 */
let refreshPromise: Promise<LatestRelease | null> | null = null;

function readSessionCache(): LatestRelease | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; release: LatestRelease };
    if (!cached?.at || Date.now() - cached.at > SESSION_CACHE_TTL_MS) return null;
    // Guard the shape too: a cache entry written by an older build of this
    // page would otherwise render tiles with no assets behind them.
    return cached.release?.downloads?.length ? cached.release : null;
  } catch {
    return null;
  }
}

function writeSessionCache(release: LatestRelease): void {
  try {
    window.sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ at: Date.now(), release }),
    );
  } catch {
    // Private-mode / storage-disabled browsers just re-fetch. Not fatal.
  }
}

function refreshLatestRelease(): Promise<LatestRelease | null> {
  refreshPromise ??= (async () => {
    const cached = readSessionCache();
    if (cached) return cached;
    const release = await fetchLatestRelease({ timeoutMs: 6000 });
    if (release) writeSessionCache(release);
    return release;
  })();
  return refreshPromise;
}

/** The build-time release, upgraded in place once the browser has a fresher one. */
function useLatestRelease(initial: LatestRelease | null): LatestRelease | null {
  const [release, setRelease] = React.useState<LatestRelease | null>(initial);

  React.useEffect(() => {
    let cancelled = false;
    void refreshLatestRelease().then((fresh) => {
      if (!cancelled && fresh) setRelease(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return release;
}

/**
 * The visitor's platform, resolved after mount so the server-rendered HTML
 * stays identical for everyone (this is a static export — the same file is
 * served to every OS).
 *
 * Architecture is a guess: only Chromium exposes it, and only behind the
 * async high-entropy client hints. macOS defaults to Apple Silicon because
 * that is the only Mac build shipped; the button label always names the build
 * it is about to download, so a wrong guess is visible rather than silent.
 */
function useDetectedPlatform(): { os: OsKey | null; arch: ArchKey | null } {
  const [platform, setPlatform] = React.useState<{
    os: OsKey | null;
    arch: ArchKey | null;
  }>({ os: null, arch: null });

  React.useEffect(() => {
    const ua = navigator.userAgent;
    const os: OsKey | null = /Mac|iPhone|iPad|iPod/i.test(ua)
      ? "mac"
      : /Win/i.test(ua)
        ? "windows"
        : /Linux|X11|CrOS/i.test(ua)
          ? "linux"
          : null;

    const uaArch: ArchKey | null = /arm64|aarch64/i.test(ua)
      ? "arm64"
      : /x86_64|x64|win64|wow64|amd64/i.test(ua)
        ? "x64"
        : os === "mac"
          ? "arm64"
          : null;

    setPlatform({ os, arch: uaArch });

    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;

    let cancelled = false;
    void uaData
      ?.getHighEntropyValues?.(["architecture"])
      .then((values) => {
        if (cancelled || !values.architecture) return;
        const arch: ArchKey | null = /arm/i.test(values.architecture)
          ? "arm64"
          : /x86|amd/i.test(values.architecture)
            ? "x64"
            : null;
        if (arch) setPlatform((current) => ({ ...current, arch }));
      })
      .catch(() => {
        // Client hints are best-effort; the UA-string guess stands.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return platform;
}

function downloadTitle(download: ReleaseDownload, version: string): string {
  return `${OS_LABELS[download.os]} ${version} — ${download.label}${
    download.asset.size ? `, ${formatAssetSize(download.asset.size)}` : ""
  }`;
}

/**
 * The headline download button. Resolves to the detected platform's file;
 * before detection (and when nothing resolved) it stays a generic link to the
 * releases page, so it is never disabled or empty.
 */
export function DownloadPrimaryButton({
  release: initialRelease,
  className,
  size = "lg",
  label,
}: {
  release: LatestRelease | null;
  className?: string;
  size?: "default" | "lg";
  /** Overrides the generated label, e.g. on the closing CTA. */
  label?: string;
}) {
  const release = useLatestRelease(initialRelease);
  const { os, arch } = useDetectedPlatform();
  const download = pickDownload(release, os, arch);
  const version = release?.version;

  const href = download?.asset.url ?? release?.htmlUrl ?? releasesLatestUrl;
  const isDirect = Boolean(download);
  const text =
    label ??
    (download
      ? `Download for ${OS_LABELS[download.os]}`
      : version
        ? `Download Classifyre ${version}`
        : "Download Classifyre");

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button
        asChild
        size={size}
        className={cn(
          "h-auto w-full whitespace-normal border-2 border-accent bg-accent py-3 text-center leading-snug text-black hover:bg-accent/90",
          className,
        )}
      >
        <a
          href={href}
          // A direct asset link is a file, not a page: no new tab, and the
          // download attribute keeps the browser from trying to render it.
          {...(isDirect
            ? { download: download!.asset.name }
            : { target: "_blank", rel: "noreferrer" })}
        >
          {text}
          {version ? ` ${version}` : ""}
        </a>
      </Button>
      <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {download
          ? `${download.label}${
              download.asset.size ? ` · ${formatAssetSize(download.asset.size)}` : ""
            } · free · no signup`
          : "macOS · Windows · Linux — free, no signup"}
      </p>
    </div>
  );
}

/**
 * The three-platform grid. Each tile links straight at that platform's
 * recommended package; extra builds for the same OS (Intel, `.rpm`, the macOS
 * update zip) sit underneath as secondary links rather than being hidden.
 */
export function DownloadPlatformGrid({
  release: initialRelease,
  size = "compact",
  notes,
}: {
  release: LatestRelease | null;
  /** "compact" is the landing card; "full" is the /download page. */
  size?: "compact" | "full";
  /** Optional per-OS footnote, shown on the roomier /download page. */
  notes?: Partial<Record<OsKey, string>>;
}) {
  const release = useLatestRelease(initialRelease);
  const { os: detectedOs, arch } = useDetectedPlatform();
  const groups = groupByOs(release);
  const full = size === "full";

  // Nothing resolved: keep the old shape — three tiles pointing at the
  // releases page — rather than collapsing the section.
  const fallbackGroups = (["mac", "windows", "linux"] as OsKey[]).map((os) => ({
    os,
    label: OS_LABELS[os],
    variants: [] as ReleaseDownload[],
  }));

  return (
    <ul
      className={cn(
        "grid gap-3",
        full ? "gap-4 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {(groups.length > 0 ? groups : fallbackGroups).map((group) => {
        const Logo = OS_LOGOS[group.os];
        const recommended =
          group.variants.find(
            (variant) => variant.arch === (detectedOs === group.os ? arch : null),
          ) ?? group.variants[0];
        const alternates = group.variants.filter(
          (variant) => variant.id !== recommended?.id,
        );
        const isDetected = detectedOs === group.os;

        return (
          <li key={group.os}>
            <div
              className={cn(
                "flex h-full flex-col border-2 bg-background transition-all",
                isDetected
                  ? "border-accent shadow-[4px_4px_0_var(--color-accent)]"
                  : "border-border",
                full && !isDetected && "shadow-[4px_4px_0_var(--color-border)]",
              )}
            >
              <a
                href={recommended?.asset.url ?? release?.htmlUrl ?? releasesLatestUrl}
                {...(recommended
                  ? { download: recommended.asset.name }
                  : { target: "_blank", rel: "noreferrer" })}
                title={
                  recommended && release
                    ? downloadTitle(recommended, release.version)
                    : undefined
                }
                className={cn(
                  "group flex flex-1 flex-col items-center gap-3 px-3 text-center transition-all hover:bg-accent/10",
                  full ? "py-6" : "py-6",
                )}
              >
                <Logo
                  className={cn(
                    "text-foreground transition-transform group-hover:scale-110",
                    full ? "h-16 w-16 sm:h-20 sm:w-20" : "h-12 w-12 sm:h-16 sm:w-16",
                  )}
                />
                <span
                  className={cn(
                    "font-serif font-black uppercase tracking-[0.04em]",
                    full ? "text-xl" : "text-base",
                  )}
                >
                  {group.label}
                </span>
                {recommended ? (
                  <>
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent-foreground/70 dark:text-accent">
                      {recommended.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {formatAssetSize(recommended.asset.size)}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    View releases
                  </span>
                )}
                {notes?.[group.os] ? (
                  <span className="pt-2 text-sm leading-6 text-muted-foreground">
                    {notes[group.os]}
                  </span>
                ) : null}
                {isDetected ? (
                  <span className="mt-auto pt-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-accent-foreground/80 dark:text-accent">
                    Your system
                  </span>
                ) : null}
              </a>

              {alternates.length > 0 ? (
                <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 border-t-2 border-border px-3 py-2">
                  {alternates.map((variant) => (
                    <li key={variant.id}>
                      <a
                        href={variant.asset.url}
                        download={variant.asset.name}
                        title={
                          release ? downloadTitle(variant, release.version) : undefined
                        }
                        className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {variant.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "All builds and checksums on GitHub" — the escape hatch under the grid. */
export function AllReleasesLink({
  release: initialRelease,
  className,
}: {
  release: LatestRelease | null;
  className?: string;
}) {
  const release = useLatestRelease(initialRelease);
  return (
    <a
      href={release?.htmlUrl ?? releasesLatestUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
        className,
      )}
    >
      All builds on GitHub →
    </a>
  );
}
