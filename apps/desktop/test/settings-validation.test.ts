/**
 * Bounds and restart semantics for the desktop settings window.
 *
 * Everything here is reachable from a text field, and settings.json is also
 * hand-editable, so the validation is the only thing between a typo and a
 * process that will not start. The restart diff matters just as much in the
 * other direction: prompting for a restart that changes nothing trains people
 * to dismiss the prompt that does.
 *
 * Run with Node 22:
 *   npx tsx test/settings-validation.test.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "classifyre-settings-"));
process.env["CLASSIFYRE_DATA_DIR"] = dataDir;

async function main(): Promise<void> {
  const {
    DEFAULT_SETTINGS,
    MAX_CONCURRENT_RUNNERS_LIMIT,
    SettingsManager,
    applySettingsPatch,
    restartRequired,
  } = await import("../src/main/settings-manager");

  // --- ports -------------------------------------------------------------
  // 0 keeps the historical ephemeral bind for the API; the database has no
  // such mode, because its port is what an external tool is pointed at.
  assert.equal(DEFAULT_SETTINGS.apiPort, 0);
  assert.equal(applySettingsPatch(DEFAULT_SETTINGS, { apiPort: 0 }).apiPort, 0);
  assert.equal(
    applySettingsPatch(DEFAULT_SETTINGS, { apiPort: 8123 }).apiPort,
    8123,
  );
  for (const bad of [1, 1023, 65_536, -1, 8080.5]) {
    assert.throws(
      () => applySettingsPatch(DEFAULT_SETTINGS, { apiPort: bad }),
      /API port/,
      `apiPort ${bad} should have been rejected`,
    );
  }
  for (const bad of [0, 1023, 65_536, 5432.5]) {
    assert.throws(
      () => applySettingsPatch(DEFAULT_SETTINGS, { postgresPort: bad }),
      /Database port/,
      `postgresPort ${bad} should have been rejected`,
    );
  }

  // --- concurrency -------------------------------------------------------
  // 0 is "unlimited", not "never run a scan".
  assert.equal(
    applySettingsPatch(DEFAULT_SETTINGS, { maxConcurrentRunners: 0 })
      .maxConcurrentRunners,
    0,
  );
  assert.equal(
    applySettingsPatch(DEFAULT_SETTINGS, {
      maxConcurrentRunners: MAX_CONCURRENT_RUNNERS_LIMIT,
    }).maxConcurrentRunners,
    MAX_CONCURRENT_RUNNERS_LIMIT,
  );
  for (const bad of [-1, MAX_CONCURRENT_RUNNERS_LIMIT + 1, 2.5]) {
    assert.throws(
      () => applySettingsPatch(DEFAULT_SETTINGS, { maxConcurrentRunners: bad }),
      /Concurrent scans/,
      `maxConcurrentRunners ${bad} should have been rejected`,
    );
  }

  // --- restart diff ------------------------------------------------------
  assert.equal(restartRequired(DEFAULT_SETTINGS, DEFAULT_SETTINGS), false);
  // These two apply live; prompting for them would be noise.
  for (const key of ["runInBackground", "desktopNotifications"] as const) {
    const after = applySettingsPatch(DEFAULT_SETTINGS, {
      [key]: !DEFAULT_SETTINGS[key],
    });
    assert.equal(
      restartRequired(DEFAULT_SETTINGS, after),
      false,
      `${key} must not demand a restart`,
    );
  }
  // Each of these is read once, while a process is starting.
  const restartCases: Partial<Parameters<typeof applySettingsPatch>[1]>[] = [
    { apiPort: 8123 },
    { postgresPort: 55_000 },
    { memoryLimitMb: 3072 },
    { maxConcurrentRunners: 1 },
    { readonlyDbEnabled: true },
  ];
  for (const patch of restartCases) {
    assert.equal(
      restartRequired(DEFAULT_SETTINGS, applySettingsPatch(DEFAULT_SETTINGS, patch)),
      true,
      `${Object.keys(patch)[0]} must demand a restart`,
    );
  }

  // --- persistence -------------------------------------------------------
  // A rejected field must not leave the file holding half of a save.
  const settings = new SettingsManager();
  settings.update({ apiPort: 8123, maxConcurrentRunners: 3 });
  assert.throws(() =>
    settings.update({ apiPort: 9000, maxConcurrentRunners: 99 }),
  );
  assert.equal(settings.get().apiPort, 8123);
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(dataDir, "settings.json"), "utf-8"),
  ) as { apiPort: number; maxConcurrentRunners: number };
  assert.equal(onDisk.apiPort, 8123);
  assert.equal(onDisk.maxConcurrentRunners, 3);

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("settings-validation: all assertions passed");
}

void main();
