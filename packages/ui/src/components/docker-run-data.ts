import { dockerImageRef } from "../lib/site-links";
import { softwareVersion } from "../lib/software-version";

/**
 * Pure docker-run data helpers (no `"use client"`), so server components can
 * build translated command lines and pass them to the client `DockerRunBlock`.
 */
export type RunLine = { code: string; note?: string };

/**
 * The tag to quote: the version this site was built from, unless that is a
 * pre-release.
 *
 * `softwareVersion` is whatever the workspace package.json says, and on
 * `develop` that is a `-SNAPSHOT` for which no image was ever pushed. Quoting
 * it would hand a visitor a command that fails on `docker run` with a manifest
 * error — strictly worse than a moving tag. So a release pins, and anything
 * pre-release falls back to `latest`, which always resolves.
 */
export const dockerImageTag = /-(SNAPSHOT|rc|alpha|beta)/i.test(softwareVersion)
  ? "latest"
  : softwareVersion;

export function dockerRunLines(
  tag: string = dockerImageTag,
  notes?: readonly [string, string, string, string, string],
): RunLine[] {
  const [port, shm, pgdata, data, cache] = notes ?? [
    "the only port it serves",
    "Postgres needs it; the default is too small",
    "your data",
    "scan logs + credential key",
    "survives upgrades",
  ];
  return [
    { code: "docker run -d --name classifyre \\" },
    { code: "  -p 3000:3000 \\", note: port },
    { code: "  --shm-size=1g \\", note: shm },
    { code: "  -v classifyre-pgdata:/var/lib/postgresql/data \\", note: pgdata },
    { code: "  -v classifyre-data:/var/lib/classifyre \\", note: data },
    { code: "  -v classifyre-uv-cache:/cache/uv \\", note: cache },
    { code: `  ${dockerImageRef}:${tag}` },
  ];
}

export function dockerRunCommand(tag: string = dockerImageTag): string {
  return dockerRunLines(tag)
    .map((line) => line.code)
    .join("\n");
}
