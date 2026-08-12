import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPostgresScramVerifier,
  LEGACY_POSTGRES_PASSWORD,
  PostgresCredentialStore,
  type CredentialProtection,
  upgradePgHbaToScram,
} from "../src/main/postgres-credentials";

class TestProtection implements CredentialProtection {
  constructor(private readonly available = true) {}

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async encrypt(plaintext: string): Promise<Buffer> {
    return Buffer.from(plaintext, "utf-8").map((byte) => byte ^ 0xa5);
  }

  async decrypt(
    ciphertext: Buffer,
  ): Promise<{ plaintext: string; shouldReEncrypt: boolean }> {
    return {
      plaintext: Buffer.from(ciphertext)
        .map((byte) => byte ^ 0xa5)
        .toString("utf-8"),
      shouldReEncrypt: false,
    };
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classifyre-pg-secret-"));
  try {
    const firstDate = new Date("2026-01-01T00:00:00.000Z");
    const protectedDir = path.join(root, "protected");
    const protectedStore = new PostgresCredentialStore(
      protectedDir,
      new TestProtection(),
      () => firstDate,
    );

    const fresh = await protectedStore.loadOrCreate(false);
    assert.equal(fresh.version, 1);
    assert.notEqual(fresh.current, LEGACY_POSTGRES_PASSWORD);
    assert.match(fresh.current, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(fresh.pending, undefined);

    const encryptedBytes = fs.readFileSync(protectedStore.path);
    assert.equal(encryptedBytes.includes(Buffer.from(fresh.current)), false);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(protectedStore.path).mode & 0o777, 0o600);
    }

    // A second process/load receives the same credential; it is not generated
    // afresh on every application boot.
    const reloaded = await new PostgresCredentialStore(
      protectedDir,
      new TestProtection(),
      () => firstDate,
    ).loadOrCreate(false);
    assert.deepEqual(reloaded, fresh);

    // Existing installs journal the generated successor before touching the
    // database. A restart sees both values and can recover either side of
    // ALTER ROLE.
    const legacyDir = path.join(root, "legacy");
    const legacyStore = new PostgresCredentialStore(
      legacyDir,
      new TestProtection(),
      () => firstDate,
    );
    const legacy = await legacyStore.loadOrCreate(true);
    assert.equal(legacy.current, LEGACY_POSTGRES_PASSWORD);
    const staged = await legacyStore.stageRotationIfDue(legacy);
    assert.equal(staged.current, LEGACY_POSTGRES_PASSWORD);
    assert.ok(staged.pending);
    assert.notEqual(staged.pending, staged.current);

    const recovered = await new PostgresCredentialStore(
      legacyDir,
      new TestProtection(),
      () => firstDate,
    ).loadOrCreate(true);
    assert.deepEqual(recovered, staged);

    const committed = await legacyStore.commitRotation(recovered);
    assert.equal(committed.current, staged.pending);
    assert.equal(committed.pending, undefined);

    // Normal credentials rotate after 90 days, but not before.
    const day89 = new PostgresCredentialStore(
      protectedDir,
      new TestProtection(),
      () => new Date("2026-03-31T23:59:59.000Z"),
    );
    const notDue = await day89.stageRotationIfDue(
      await day89.loadOrCreate(false),
    );
    assert.equal(notDue.pending, undefined);
    const day91 = new PostgresCredentialStore(
      protectedDir,
      new TestProtection(),
      () => new Date("2026-04-02T00:00:00.000Z"),
    );
    const due = await day91.stageRotationIfDue(await day91.loadOrCreate(false));
    assert.ok(due.pending);

    // Linux systems without a usable keyring remain functional and restrict
    // the fallback to the current OS account. It upgrades automatically once
    // protection becomes available (covered by loading through protectedStore).
    const fallbackDir = path.join(root, "fallback");
    const fallbackStore = new PostgresCredentialStore(
      fallbackDir,
      new TestProtection(false),
      () => firstDate,
    );
    const fallback = await fallbackStore.loadOrCreate(false);
    assert.ok(
      fs
        .readFileSync(fallbackStore.path)
        .includes(Buffer.from(fallback.current)),
    );
    const upgradedStore = new PostgresCredentialStore(
      fallbackDir,
      new TestProtection(true),
      () => firstDate,
    );
    await upgradedStore.loadOrCreate(false);
    assert.equal(
      fs
        .readFileSync(upgradedStore.path)
        .includes(Buffer.from(fallback.current)),
      false,
    );

    const hba = [
      "# TYPE DATABASE USER ADDRESS METHOD\n",
      "local all all password\n",
      "host all all 127.0.0.1/32 md5 # old client auth\n",
      "host all all ::1/128 scram-sha-256\n",
      "host all all 10.0.0.0/8 reject\n",
    ].join("");
    assert.equal(
      upgradePgHbaToScram(hba),
      [
        "# TYPE DATABASE USER ADDRESS METHOD\n",
        "local all all scram-sha-256\n",
        "host all all 127.0.0.1/32 scram-sha-256 # old client auth\n",
        "host all all ::1/128 scram-sha-256\n",
        "host all all 10.0.0.0/8 reject\n",
      ].join(""),
    );

    assert.equal(
      createPostgresScramVerifier(
        "correct horse battery staple",
        Buffer.from("0123456789abcdef", "utf-8"),
      ),
      "SCRAM-SHA-256$4096:MDEyMzQ1Njc4OWFiY2RlZg==$5uVcxEsM9g7qPWkT/Usq98S+VIB8ZwsV7h8MtqvDrsw=:w3JcoKUbh5ZrGRqalbS6V0TZabsE2hsOQi9C15FvDZk=",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main()
  .then(() => console.log("postgres-credentials: all assertions passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
