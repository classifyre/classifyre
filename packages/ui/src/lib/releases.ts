/**
 * Resolves the GitHub release the marketing site should hand out, so the
 * download buttons point at an actual `.dmg`/`.zip`/`.deb`/`.rpm` instead of
 * dropping the visitor on the releases page to guess.
 *
 * The asset-name rules mirror `apps/desktop/src/main/update-checker.ts`
 * (`pickAsset`) — the in-app updater and this page must agree on which file a
 * given platform gets, or an update and a fresh download disagree.
 *
 * Resolution happens twice, and both halves are allowed to fail:
 *  - at build time, from the server component, so the exported HTML already
 *    carries working links even for a visitor whose browser never reaches
 *    api.github.com;
 *  - once more in the browser (`useLatestRelease`), so a desktop release cut
 *    after the last site deploy is picked up without a rebuild.
 * If both fail, callers fall back to the releases page.
 */

export type OsKey = "mac" | "windows" | "linux";
export type ArchKey = "arm64" | "x64";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseDownload {
  id: string;
  os: OsKey;
  arch: ArchKey;
  /** Package extension, shown as the link's subject: ".dmg", ".deb". */
  format: string;
  /** How this build is described to a human: "Apple Silicon · .dmg". */
  label: string;
  asset: ReleaseAsset;
}

export interface OsDownloads {
  os: OsKey;
  label: string;
  /** Recommended build first; see `rank` on the variant table. */
  variants: ReleaseDownload[];
}

export interface LatestRelease {
  /** Version without the leading "v" — "0.4.88". */
  version: string;
  tag: string;
  htmlUrl: string;
  publishedAt: string | null;
  downloads: ReleaseDownload[];
}

export const RELEASES_LATEST_API =
  "https://api.github.com/repos/classifyre/classifyre/releases/latest";

export const OS_LABELS: Record<OsKey, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

const ARCH_LABELS: Record<OsKey, Record<ArchKey, string>> = {
  mac: { arm64: "Apple Silicon", x64: "Intel" },
  windows: { arm64: "ARM64", x64: "x64" },
  linux: { arm64: "ARM64", x64: "x64" },
};

interface VariantSpec {
  id: string;
  os: OsKey;
  arch: ArchKey;
  format: string;
  /** Lower wins when one OS+arch has several packages (mac: dmg over zip). */
  rank: number;
  matches: (lowerName: string) => boolean;
}

/**
 * Every artifact `apps/desktop/forge.config.ts` can produce, in the order a
 * visitor should be offered them. Entries with no matching asset in the
 * release are dropped, so a platform that failed to build simply doesn't
 * appear rather than linking to a 404.
 */
const VARIANTS: readonly VariantSpec[] = [
  {
    id: "mac-arm64-dmg",
    os: "mac",
    arch: "arm64",
    format: ".dmg",
    rank: 0,
    matches: (n) => n.endsWith(".dmg") && (n.includes("arm64") || n.includes("aarch64")),
  },
  {
    id: "mac-arm64-zip",
    os: "mac",
    arch: "arm64",
    format: ".zip",
    rank: 1,
    matches: (n) => n.endsWith(".zip") && n.includes("darwin") && n.includes("arm64"),
  },
  {
    id: "mac-x64-dmg",
    os: "mac",
    arch: "x64",
    format: ".dmg",
    rank: 0,
    matches: (n) => n.endsWith(".dmg") && (n.includes("x64") || n.includes("x86_64") || n.includes("intel")),
  },
  {
    id: "mac-x64-zip",
    os: "mac",
    arch: "x64",
    format: ".zip",
    rank: 1,
    matches: (n) => n.endsWith(".zip") && n.includes("darwin") && n.includes("x64"),
  },
  {
    id: "windows-x64-zip",
    os: "windows",
    arch: "x64",
    format: ".zip",
    rank: 0,
    matches: (n) => n.endsWith(".zip") && n.includes("win32") && n.includes("x64"),
  },
  {
    id: "windows-arm64-zip",
    os: "windows",
    arch: "arm64",
    format: ".zip",
    rank: 0,
    matches: (n) => n.endsWith(".zip") && n.includes("win32") && n.includes("arm64"),
  },
  {
    id: "linux-x64-deb",
    os: "linux",
    arch: "x64",
    format: ".deb",
    rank: 0,
    matches: (n) => n.endsWith(".deb") && n.includes("amd64"),
  },
  {
    id: "linux-x64-rpm",
    os: "linux",
    arch: "x64",
    format: ".rpm",
    rank: 1,
    matches: (n) => n.endsWith(".rpm") && n.includes("x86_64"),
  },
  {
    id: "linux-arm64-deb",
    os: "linux",
    arch: "arm64",
    format: ".deb",
    rank: 0,
    matches: (n) => n.endsWith(".deb") && n.includes("arm64"),
  },
  {
    id: "linux-arm64-rpm",
    // Forge's RPM maker names the ARM build ".arm64.rpm", not the ".aarch64"
    // rpm convention, so both spellings have to be accepted here.
    os: "linux",
    arch: "arm64",
    format: ".rpm",
    rank: 1,
    matches: (n) => n.endsWith(".rpm") && (n.includes("aarch64") || n.includes("arm64")),
  },
];

const OS_ORDER: readonly OsKey[] = ["mac", "windows", "linux"];

/** Maps a release's raw asset list onto the platform builds we advertise. */
export function resolveDownloads(assets: readonly ReleaseAsset[]): ReleaseDownload[] {
  const downloads: ReleaseDownload[] = [];
  for (const variant of VARIANTS) {
    const asset = assets.find((candidate) => variant.matches(candidate.name.toLowerCase()));
    if (!asset) continue;
    downloads.push({
      id: variant.id,
      os: variant.os,
      arch: variant.arch,
      format: variant.format,
      label: `${ARCH_LABELS[variant.os][variant.arch]} · ${variant.format}`,
      asset,
    });
  }
  return downloads;
}

/** Groups resolved builds by OS, recommended build first, for the platform grid. */
export function groupByOs(release: LatestRelease | null): OsDownloads[] {
  if (!release) return [];
  return OS_ORDER.map((os) => ({
    os,
    label: OS_LABELS[os],
    variants: release.downloads.filter((download) => download.os === os),
  })).filter((group) => group.variants.length > 0);
}

/**
 * The single build to offer someone on `os`/`arch`. Falls back to the other
 * architecture for that OS rather than returning nothing — an Intel Mac with
 * no Intel build is still better served by a visible (if wrong-arch) link than
 * by a dead button, and the label says which build it is.
 */
export function pickDownload(
  release: LatestRelease | null,
  os: OsKey | null,
  arch: ArchKey | null,
): ReleaseDownload | null {
  if (!release || !os) return null;
  const forOs = release.downloads.filter((download) => download.os === os);
  if (forOs.length === 0) return null;
  const exact = arch ? forOs.filter((download) => download.arch === arch) : [];
  return (exact[0] ?? forOs[0]) as ReleaseDownload;
}

/** Human-readable asset size. GitHub reports bytes; downloads read in MB. */
export function formatAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

interface RawRelease {
  tag_name?: string;
  draft?: boolean;
  html_url?: string;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

/** Narrows the GitHub payload to what the site renders. Null if unusable. */
export function parseRelease(raw: unknown): LatestRelease | null {
  const release = raw as RawRelease | null;
  const tag = release?.tag_name;
  if (!release || !tag || release.draft) return null;

  const assets: ReleaseAsset[] = (release.assets ?? [])
    .filter((asset): asset is { name: string; browser_download_url: string; size?: number } =>
      Boolean(asset?.name && asset.browser_download_url),
    )
    .map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size ?? 0,
    }));

  const downloads = resolveDownloads(assets);
  if (downloads.length === 0) return null;

  return {
    version: tag.replace(/^v/, ""),
    tag,
    htmlUrl: release.html_url ?? `https://github.com/classifyre/classifyre/releases/tag/${tag}`,
    publishedAt: release.published_at ?? null,
    downloads,
  };
}

/**
 * Best-effort fetch of the latest release. Never throws: an offline build, a
 * rate-limited browser, or a release with no desktop assets all resolve to
 * null, and callers fall back to the releases page.
 */
export async function fetchLatestRelease(
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LatestRelease | null> {
  const { signal, timeoutMs = 8000 } = options;
  // Build-time only: an authenticated call lifts GitHub's 60/hour anonymous
  // limit, which a shared CI runner IP can otherwise be sitting on.
  const token =
    typeof window === "undefined"
      ? (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)
      : undefined;

  try {
    const response = await fetch(RELEASES_LATEST_API, {
      signal: signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  } catch {
    return null;
  }
}
