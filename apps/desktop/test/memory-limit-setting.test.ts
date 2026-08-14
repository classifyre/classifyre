/**
 * The user-facing API memory limit: menu choices, persistence, validation.
 *
 * The menu is the only way most people will ever change this, so a choice the
 * SettingsManager rejects, or one the spawn silently clamps, is a broken
 * control rather than a cosmetic bug — the user picks "4 GB", nothing changes,
 * and the app keeps crashing the same way.
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
  const { MEMORY_LIMIT_CHOICES } = await import("../src/main/menu");
  const { computeApiHeapMb, ELECTRON_MAX_OLD_SPACE_MB, DEFAULT_API_HEAP_MB } =
    await import("../src/main/process-manager");

  // Automatic stays the default: raising the ceiling is opt-in, because a larger
  // heap means V8 collects less often and is usually the wrong lever.
  assert.equal(DEFAULT_SETTINGS.memoryLimitMb, 0);

  const settings = new SettingsManager();
  assert.equal(settings.get().memoryLimitMb, 0);

  // Every offered choice must be accepted, persisted, and actually reach the
  // spawned process as the value shown in the menu.
  for (const { label, value } of MEMORY_LIMIT_CHOICES) {
    const saved = settings.update({ memoryLimitMb: value }).memoryLimitMb;
    assert.equal(saved, value, `${label} was not persisted`);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dataDir, "settings.json"), "utf-8"),
    ) as { memoryLimitMb: number };
    assert.equal(onDisk.memoryLimitMb, value, `${label} did not survive a write`);

    const heap = computeApiHeapMb(34_359, 4, value);
    assert.equal(
      heap,
      value === 0 ? DEFAULT_API_HEAP_MB : value,
      `${label} did not reach the API as chosen`,
    );
  }

  // No choice may exceed what Electron will grant, or the menu would promise
  // memory the runtime silently refuses.
  for (const { label, value } of MEMORY_LIMIT_CHOICES) {
    assert.ok(
      value <= ELECTRON_MAX_OLD_SPACE_MB,
      `${label} (${value} MB) is above the Electron ceiling`,
    );
  }

  // Exactly one automatic entry, and it is first: the radio group needs a
  // well-defined default and the recommended option should lead.
  assert.equal(MEMORY_LIMIT_CHOICES.filter((c) => c.value === 0).length, 1);
  assert.equal(MEMORY_LIMIT_CHOICES[0]?.value, 0);

  // Hand-edited settings.json is still rejected when it cannot boot the API.
  for (const bad of [512, 1023, -1, 1.5]) {
    assert.throws(
      () => settings.update({ memoryLimitMb: bad }),
      /at least 1024 MB|automatic/i,
      `${bad} MB should have been rejected`,
    );
  }

  // A hand-edited value above the Electron ceiling is not rejected — it is
  // clamped at spawn — so it can never request memory that is refused.
  assert.equal(
    computeApiHeapMb(34_359, 4, 16_384),
    ELECTRON_MAX_OLD_SPACE_MB,
    "an oversized hand-edited limit must be clamped, not honoured",
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("memory-limit-setting: all assertions passed");
}

void main();
