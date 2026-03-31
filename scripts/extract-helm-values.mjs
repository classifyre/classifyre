/**
 * Extracts the values reference table from the helm-docs generated README
 * and writes it as an MDX file that the docs site imports at build time.
 *
 * Input:  helm/classifyre/README.md   (committed, updated by `bun run ops:helm:docs`)
 * Output: apps/docs/src/_generated/helm-values.mdx  (committed generated artifact)
 *
 * Run:  node scripts/extract-helm-values.mjs
 * Or:   automatically via `apps/docs` package.json prebuild step
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const helmReadme = resolve(repoRoot, "helm/classifyre/README.md");
const outputDir = resolve(repoRoot, "apps/docs/src/_generated");
const outputFile = resolve(outputDir, "helm-values.mdx");
const checkMode = process.argv.includes("--check");

const readme = readFileSync(helmReadme, "utf8");

const valuesStart = readme.indexOf("\n## Values\n");
if (valuesStart === -1) {
  throw new Error(`Could not find "## Values" section in ${helmReadme}`);
}

// Skip past the "## Values\n" heading — the docs page supplies its own heading
const content = readme.slice(valuesStart + "\n## Values\n".length).trim();

const nextContent = [
  "{/* AUTO-GENERATED — do not edit. Run `bun run ops:helm:docs` then rebuild docs. */}",
  "",
  content,
  "",
].join("\n");

if (checkMode) {
  const currentContent = existsSync(outputFile)
    ? readFileSync(outputFile, "utf8")
    : null;

  if (currentContent !== nextContent) {
    console.error(
      "Generated Helm docs are out of date. Run `node scripts/extract-helm-values.mjs` and commit apps/docs/src/_generated/helm-values.mdx.",
    );
    process.exit(1);
  }

  console.log(`✓ helm values up to date → ${outputFile}`);
} else {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, nextContent, "utf8");
  console.log(`✓ helm values extracted → ${outputFile}`);
}
