import Link from "next/link";

import {
  DockerLogo,
  DockerRunBlock,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";
import { helmChartRef } from "@workspace/ui/lib/site-links";
import { softwareVersion } from "@workspace/ui/lib/software-version";

/**
 * The two ways to get Classifyre running.
 *
 * The docs used to open on "connect a source", which assumes a reader who
 * already has the application. This is the missing first step: the all-in-one
 * Docker image, and the Helm chart.
 *
 * The run command is the same component the marketing site uses
 * (`@workspace/ui/components/docker-run`), so both sites quote it identically.
 */

const HELM_INSTALL_LINES = [
  "helm install classifyre \\",
  `  ${helmChartRef} \\`,
  "  --namespace classifyre --create-namespace \\",
  `  --version ${softwareVersion}`,
];

/** The Docker half on its own — used by the Docker install guide. */
export function DockerQuickstart() {
  return (
    <div className="not-prose my-6 flex flex-col gap-3">
      <DockerRunBlock />
      <p className="text-sm leading-6 text-muted-foreground">
        Then open{" "}
        <span className="font-mono text-foreground">localhost:3000</span>. The
        first boot initialises the database and creates a workspace, which takes
        a few minutes on a laptop.
      </p>
    </div>
  );
}

/**
 * Both distributions side by side. Rendered at the top of the docs home page,
 * before the pipeline, because installing is step zero.
 */
export function InstallOptions() {
  return (
    <div className="not-prose my-8 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {/* ── Docker ───────────────────────────────────────────────── */}
      <section
        aria-labelledby="install-docker"
        className="flex min-w-0 flex-col border-2 border-border bg-card shadow-[4px_4px_0_0_var(--border)]"
      >
        <p className="border-b-2 border-border bg-muted/40 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Option 01 · Docker
        </p>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-4">
            <DockerLogo className="h-10 w-10 shrink-0 text-foreground" />
            <div className="min-w-0">
              <h3
                id="install-docker"
                className="text-4xl uppercase leading-none"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                Run it on your machine
              </h3>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                One image · amd64 + arm64
              </p>
            </div>
          </div>

          <p className="text-sm leading-6 text-muted-foreground">
            PostgreSQL, the UI and the scan workers are all inside the image, so
            there is nothing to provision — and a bind-mounted folder is a
            source like any other.
          </p>

          <DockerRunBlock />

          <Link
            href="/deployment/docker/"
            className="mt-auto font-mono text-[13px] font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-4 hover:bg-accent hover:text-accent-foreground"
          >
            Docker install guide →
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
