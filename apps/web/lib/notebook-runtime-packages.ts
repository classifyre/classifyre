/**
 * The packages the scan runtime already has, and how to search them.
 *
 * Generated from `apps/cli/pyproject.toml` and `uv.lock` by
 * `apps/cli/scripts/generate_runtime_packages.py`, so a version shown here is
 * the version that runs. Kept out of the component so the filtering is testable
 * and so the Monaco completions read the same list.
 */

import manifest from "@workspace/schemas/notebook_runtime_packages";

export interface RuntimePackage {
  name: string;
  version: string;
  /** Import names, dotted for namespace packages (`azure.storage.blob`). */
  modules: string[];
  /**
   * `always` -- part of the base image, importable immediately.
   * `on-demand` -- installed before the notebook runs, when a cell imports it.
   */
  availability: "always" | "on-demand";
  /** The uv dependency group that provides an on-demand package. */
  group?: string;
}

export const RUNTIME_PACKAGES = (
  manifest as unknown as { packages: RuntimePackage[] }
).packages;

/** Every import name in the manifest, for editor completion. */
export const RUNTIME_MODULES: Array<{
  module: string;
  package: RuntimePackage;
}> = RUNTIME_PACKAGES.flatMap((entry) =>
  entry.modules.map((module) => ({ module, package: entry })),
).sort((left, right) => left.module.localeCompare(right.module));

/** Match on the distribution name, the import name, or the group. */
export function filterRuntimePackages(
  query: string,
  packages: RuntimePackage[] = RUNTIME_PACKAGES,
): RuntimePackage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return packages;
  return packages.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.group?.toLowerCase().includes(needle) ||
      entry.modules.some((module) => module.toLowerCase().includes(needle)),
  );
}

export function findRuntimeModule(name: string) {
  return RUNTIME_MODULES.find((entry) => entry.module === name);
}
