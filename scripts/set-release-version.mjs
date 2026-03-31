import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const packageJsonPaths = [
  "package.json",
  "apps/api/package.json",
  "apps/blog/package.json",
  "apps/docs/package.json",
  "apps/web/package.json",
  "apps/cli/package.json",
  "packages/api-client/package.json",
  "packages/devops/package.json",
  "packages/schemas/package.json",
];

const chartYamlPath = path.join(repoRoot, "helm/classifyre/Chart.yaml");

const pyprojectTomlPaths = [
  "apps/cli/pyproject.toml",
  "packages/schemas/pyproject.toml",
];

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/set-release-version.mjs <major.minor.patch>");
  process.exit(1);
}

for (const relativePath of packageJsonPaths) {
  const packageJsonPath = path.join(repoRoot, relativePath);
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  packageJson.version = version;
  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
}

const chartYaml = await fs.readFile(chartYamlPath, "utf8");
const updatedChartYaml = chartYaml
  .replace(/^version:\s*.+$/m, `version: ${version}`)
  .replace(/^appVersion:\s*.+$/m, `appVersion: "${version}"`);

await fs.writeFile(chartYamlPath, updatedChartYaml, "utf8");

for (const relativePath of pyprojectTomlPaths) {
  const tomlPath = path.join(repoRoot, relativePath);
  const toml = await fs.readFile(tomlPath, "utf8");
  const updated = toml.replace(/^version\s*=\s*".+?"$/m, `version = "${version}"`);
  await fs.writeFile(tomlPath, updated, "utf8");
}

console.log(`Updated release version to ${version}`);
