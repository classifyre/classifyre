import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const docsExportDir = path.join(repoRoot, "apps/docs/out");
const webDocsDir = path.join(repoRoot, "apps/web/public/docs");

async function ensureSourceExists() {
  try {
    const stats = await fs.stat(docsExportDir);
    if (!stats.isDirectory()) {
      throw new Error("source is not a directory");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Docs export is missing at ${docsExportDir}. Run 'bun --filter @classifyre/docs run build' first. Cause: ${reason}`,
    );
  }
}

async function sync() {
  await ensureSourceExists();

  await fs.rm(webDocsDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(webDocsDir), { recursive: true });
  await fs.cp(docsExportDir, webDocsDir, { recursive: true });

  console.log(`Synced docs export from ${docsExportDir} to ${webDocsDir}`);
}

sync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
