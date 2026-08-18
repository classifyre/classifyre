/**
 * The user-facing API memory limit: persistence, validation, and what actually
 * reaches the spawned process.
 *
 * The settings window is the only way most people will ever change this, so a
 * value the SettingsManager rejects, or one the spawn silently clamps without
 * saying so, is a broken control rather than a cosmetic bug — the user types
 * "8", nothing changes, and the app keeps crashing the same way.
 *
 * Run with Node 22:
 *   npx tsx test/memory-limit-setting.test.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// SettingsManager prefers CLASSIFYRE_DATA_DIR over app.getPath(), so pointing
// it at a temp directory keeps Electron out of this entirely.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "classifyre-settings-"));
process.env["CLASSIFYRE_DATA_DIR"] = dataDir;

async function main(): Promise<void> {
  // Imported after the env var is set, so module-level setup sees it.
  const { SettingsManager, DEFAULT_SETTINGS } = await import(
    "../src/main/settings-manager"
  );
  const { computeApiHeapMb, ELECTRON_MAX_OLD_SPACE_MB, DEFAULT_API_HEAP_MB } =
    await import("../src/main/process-manager");

  // Automatic stays the default: raising the ceiling is opt-in, because a larger
  // heap means V8 collects less often and is usually the wrong lever.
  assert.equal(DEFAULT_SETTINGS.memoryLimitMb, 0);

  const settings = new SettingsManager();
  assert.equal(settings.get().memoryLimitMb, 0);

  // The window offers a free GB number, so any whole-GB value in the usable
  // range must be accepted, persisted, and reach the spawn as chosen.
  for (const gb of [1, 1.5, 2, 3, 4]) {
    const value = Math.round(gb * 1024);
    const saved = settings.update({ memoryLimitMb: value }).memoryLimitMb;
    assert.equal(saved, value, `${gb} GB was not persisted`);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dataDir, "settings.json"), "utf-8"),
    ) as { memoryLimitMb: number };
    assert.equal(onDisk.memoryLimitMb, value, `${gb} GB did not survive a write`);

    assert.equal(
      computeApiHeapMb(34_359, 4, value),
      value,
      `${gb} GB did not reach the API as chosen`,
    );
  }

  // 0 means automatic, which must not be read as "no memory at all".
  assert.equal(settings.update({ memoryLimitMb: 0 }).memoryLimitMb, 0);
  assert.equal(computeApiHeapMb(34_359, 4, 0), DEFAULT_API_HEAP_MB);

  // Values that cannot boot the API are rejected at the door rather than
  // producing a process that dies on startup.
  for (const bad of [512, 1023, -1, 1.5]) {
    assert.throws(
      () => settings.update({ memoryLimitMb: bad }),
      /at least 1024 MB|automatic/i,
      `${bad} MB should have been rejected`,
    );
  }

  // Above the Electron ceiling the value is accepted but clamped at spawn —
  // which is precisely why the window warns about it rather than staying
  // silent. A request Electron refuses is invisible at runtime.
  for (const oversized of [6144, 16_384]) {
    assert.equal(settings.update({ memoryLimitMb: oversized }).memoryLimitMb, oversized);
    assert.equal(
      computeApiHeapMb(34_359, 4, oversized),
      ELECTRON_MAX_OLD_SPACE_MB,
      "an oversized limit must be clamped, not honoured",
    );
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("memory-limit-setting: all assertions passed");
}

void main();
