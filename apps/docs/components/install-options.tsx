import Link from "next/link";

import {
  AllReleasesLink,
  DownloadPlatformGrid,
  DownloadPrimaryButton,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";
import {
  fetchLatestRelease,
  type LatestRelease,
  type OsKey,
} from "@workspace/ui/lib/releases";
import { helmChartRef } from "@workspace/ui/lib/site-links";
import { softwareVersion } from "@workspace/ui/lib/software-version";

/**
 * The two ways to get Classifyre running, rendered from the release itself.
 *
 * The docs used to open on "connect a source", which assumes a reader who
 * already has the application. This is the missing first step: the desktop
 * builds (resolved from the latest GitHub release, so the tiles name the real
 * artifact and its size) and the Helm chart.
 *
 * The download UI is the same component the marketing site uses
 * (`@workspace/ui/components/download-links`), so both sites hand out the same
 * file for a given platform.
 */

/** Per-OS footnotes the release payload can't express. */
const PLATFORM_NOTES: Partial<Record<OsKey, string>> = {
  mac: "Signed and notarised, with in-app updates.",
  windows: "Self-contained archive — unzip and run.",
  linux: "Debian/Ubuntu and Fedora/RHEL families.",
};

const HELM_INSTALL_LINES = [
  "helm install classifyre \\",
  `  ${helmChartRef} \\`,
  "  --namespace classifyre --create-namespace \\",
  `  --version ${softwareVersion}`,
];

/**
 * Resolved at build time so the exported HTML already links at real assets;
 * the client components refresh it so a release cut after the last docs
 * deploy still wins.
 */
async function resolveRelease(): Promise<LatestRelease | null> {
  return fetchLatestRelease();
}

/** The desktop half on its own — used by the desktop install guide. */
export async function DesktopDownloads({
  showNotes = true,
}: {
  showNotes?: boolean;
}) {
  const release = await resolveRelease();

  return (
    <div className="not-prose my-6 flex flex-col gap-5">
      <DownloadPlatformGrid
        release={release}
        size="full"
        notes={showNotes ? PLATFORM_NOTES : undefined}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-full max-w-md">
          <DownloadPrimaryButton release={release} />
        </div>
        <AllReleasesLink release={release} />
      </div>
    </div>
  );
}

/**
 * Both distributions side by side. Rendered at the top of the docs home page,
 * before the pipeline, because installing is step zero.
 */
export async function InstallOptions() {
  const release = await resolveRelease();

  return (
    <div className="not-prose my-8 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {/* ── Desktop ──────────────────────────────────────────────── */}
      <section
        aria-labelledby="install-desktop"
        className="flex min-w-0 flex-col border-2 border-border bg-card shadow-[4px_4px_0_0_var(--border)]"
      >
        <p className="border-b-2 border-border bg-muted/40 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Option 01 · Desktop
        </p>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div>
            <h3
              id="install-desktop"
              className="text-4xl uppercase leading-none"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              Install it on your machine
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              One installer for macOS, Windows, or Linux. PostgreSQL and the
              scan workers are inside the package, so there is nothing to
              provision — and only the desktop build can scan a local folder.
            </p>
          </div>

          <DownloadPlatformGrid release={release} />

          <div className="flex flex-col items-center gap-2">
            <div className="w-full max-w-sm">
              <DownloadPrimaryButton release={release} />
            </div>
            <AllReleasesLink release={release} />
          </div>

          <Link
            href="/deployment/desktop/"
            className="mt-auto font-mono text-[13px] font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-4 hover:bg-accent hover:text-accent-foreground"
          >
            Desktop install guide →
          </Link>
        </div>
      </section>

      {/* ── Kubernetes ───────────────────────────────────────────── */}
      <section
        aria-labelledby="install-kubernetes"
        className="flex min-w-0 flex-col border-2 border-border bg-card shadow-[4px_4px_0_0_var(--border)]"
      >
        <p className="border-b-2 border-border bg-muted/40 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Option 02 · Kubernetes
        </p>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-4">
            <KubernetesLogo className="h-10 w-10 shrink-0 text-foreground" />
            <HelmLogo className="h-10 w-10 shrink-0 text-foreground" />
            <div className="min-w-0">
              <h3
                id="install-kubernetes"
                className="text-4xl uppercase leading-none"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                Or run it on a cluster
              </h3>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Helm, OCI-native · no repo add
              </p>
            </div>
          </div>

          <p className="text-sm leading-6 text-muted-foreground">
            The chart deploys the web UI, API, worker, and the ephemeral scan
            Jobs. PostgreSQL can be embedded for a trial or external for
            production.
          </p>

          {/* min-w-0 lets the pre's own overflow-x-auto win: the unbreakable
              OCI ref would otherwise size the whole grid track. */}
          <pre className="min-w-0 overflow-x-auto border-2 border-border bg-muted/40 px-3 py-3 font-mono text-[11px] leading-6">
            <code>{HELM_INSTALL_LINES.join("\n")}</code>
          </pre>

          <Link
            href="/deployment/kubernetes/"
            className="mt-auto font-mono text-[13px] font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-4 hover:bg-accent hover:text-accent-foreground"
          >
            Kubernetes deployment guide →
          </Link>
        </div>
      </section>
    </div>
  );
}
