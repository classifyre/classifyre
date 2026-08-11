import crypto from "crypto";
import fs from "fs";
import path from "path";

export const LEGACY_POSTGRES_PASSWORD = "classifyre";

const CREDENTIAL_VERSION = 1;
const ROTATION_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
const ENCRYPTED_HEADER = Buffer.from("classifyre-pg-credentials:v1\0", "utf-8");
const PLAINTEXT_HEADER = Buffer.from(
  "classifyre-pg-credentials:plain-v1\n",
  "utf-8",
);

export interface PostgresCredentialState {
  version: 1;
  current: string;
  pending?: string;
  rotatedAt: string;
}

/**
 * Minimal adapter around Electron safeStorage. Keeping it behind an interface
 * makes the crash-recovery journal testable without booting Electron.
 */
export interface CredentialProtection {
  isAvailable(): Promise<boolean>;
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<{
    plaintext: string;
    shouldReEncrypt: boolean;
  }>;
}

/** Upgrade only the auth-method field of embedded initdb's HBA records. */
export function upgradePgHbaToScram(contents: string): string {
  return contents
    .split(/(?<=\n)/)
    .map((line) => {
      const newline = line.endsWith("\n") ? "\n" : "";
      const body = newline ? line.slice(0, -1) : line;
      const commentAt = body.indexOf("#");
      const record = commentAt >= 0 ? body.slice(0, commentAt) : body;
      const comment = commentAt >= 0 ? body.slice(commentAt) : "";
      const tokens = record.trim().split(/\s+/);
      const authIndex = tokens[0] === "local" ? 3 : 4;
      if (
        ![
          "local",
          "host",
          "hostssl",
          "hostnossl",
          "hostgssenc",
          "hostnogssenc",
        ].includes(tokens[0] ?? "") ||
        !["password", "md5"].includes(tokens[authIndex] ?? "")
      ) {
        return line;
      }

      let seen = 0;
      const upgraded = record.replace(/\S+/g, (token) => {
        const replacement = seen === authIndex ? "scram-sha-256" : token;
        seen += 1;
        return replacement;
      });
      return `${upgraded}${comment}${newline}`;
    })
    .join("");
}

function randomPassword(): string {
  // base64url is URI-safe, while still carrying the full 256 bits of entropy.
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Build the verifier PostgreSQL stores for SCRAM-SHA-256 authentication.
 * Supplying the verifier to ALTER ROLE avoids putting the clear password in a
 * SQL statement (utility statements cannot use protocol parameters).
 */
export function createPostgresScramVerifier(
  password: string,
  salt: Buffer = crypto.randomBytes(16),
  iterations = 4096,
): string {
  if (!password || !Number.isInteger(iterations) || iterations < 4096) {
    throw new Error("Invalid PostgreSQL SCRAM verifier input");
  }
  const saltedPassword = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    32,
    "sha256",
  );
  const clientKey = crypto
    .createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const serverKey = crypto
    .createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();
  return [
    `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}`,
    `${storedKey.toString("base64")}:${serverKey.toString("base64")}`,
  ].join("$");
}

function parseState(raw: string): PostgresCredentialState {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    throw new Error("The embedded PostgreSQL credential store is corrupt", {
      cause: error,
    });
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    (candidate as { version?: unknown }).version !== CREDENTIAL_VERSION ||
    typeof (candidate as { current?: unknown }).current !== "string" ||
    (candidate as { current: string }).current.length < 8 ||
    typeof (candidate as { rotatedAt?: unknown }).rotatedAt !== "string" ||
    ((candidate as { pending?: unknown }).pending !== undefined &&
      (typeof (candidate as { pending?: unknown }).pending !== "string" ||
        (candidate as { pending: string }).pending.length < 8))
  ) {
    throw new Error(
      "The embedded PostgreSQL credential store has an invalid format",
    );
  }

  const state = candidate as PostgresCredentialState;
  if (!Number.isFinite(Date.parse(state.rotatedAt))) {
    throw new Error(
      "The embedded PostgreSQL credential rotation date is invalid",
    );
  }
  return state;
}

function isRotationDue(state: PostgresCredentialState, now: Date): boolean {
  return (
    state.current === LEGACY_POSTGRES_PASSWORD ||
    now.getTime() - Date.parse(state.rotatedAt) >= ROTATION_INTERVAL_MS
  );
}

/**
 * Stores the database password outside settings.json. The record is encrypted
 * with Electron safeStorage when an OS key provider is available. A 0600
 * plaintext fallback keeps Linux desktops without Secret Service usable; the
 * caller is expected to surface a warning for that weaker configuration.
 *
 * Rotation is journalled as { current, pending }. The pending value is saved
 * before ALTER ROLE and committed only after PostgreSQL accepts it. Therefore
 * either credential can recover an interrupted rotation without resetting the
 * database.
 */
export class PostgresCredentialStore {
  private readonly filePath: string;

  constructor(
    baseDir: string,
    private readonly protection: CredentialProtection,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.filePath = path.join(baseDir, "postgres-credentials.bin");
  }

  get path(): string {
    return this.filePath;
  }

  async loadOrCreate(clusterExists: boolean): Promise<PostgresCredentialState> {
    const existing = await this.load();
    if (existing) return existing;

    const state: PostgresCredentialState = {
      version: CREDENTIAL_VERSION,
      current: clusterExists ? LEGACY_POSTGRES_PASSWORD : randomPassword(),
      // An existing cluster is deliberately due immediately, which migrates
      // the historical hard-coded password on its first upgraded launch.
      rotatedAt: clusterExists
        ? new Date(0).toISOString()
        : this.now().toISOString(),
    };
    await this.save(state);
    return state;
  }

  async stageRotationIfDue(
    state: PostgresCredentialState,
  ): Promise<PostgresCredentialState> {
    if (state.pending || !isRotationDue(state, this.now())) return state;
    const staged = { ...state, pending: randomPassword() };
    await this.save(staged);
    return staged;
  }

  async commitRotation(
    state: PostgresCredentialState,
  ): Promise<PostgresCredentialState> {
    if (!state.pending) return state;
    const committed: PostgresCredentialState = {
      version: CREDENTIAL_VERSION,
      current: state.pending,
      rotatedAt: this.now().toISOString(),
    };
    await this.save(committed);
    return committed;
  }

  private async load(): Promise<PostgresCredentialState | null> {
    let stored: Buffer;
    try {
      stored = await fs.promises.readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    let plaintext: string;
    let shouldReEncrypt: boolean;
    if (stored.subarray(0, ENCRYPTED_HEADER.length).equals(ENCRYPTED_HEADER)) {
      const result = await this.protection.decrypt(
        stored.subarray(ENCRYPTED_HEADER.length),
      );
      plaintext = result.plaintext;
      shouldReEncrypt = result.shouldReEncrypt;
    } else if (
      stored.subarray(0, PLAINTEXT_HEADER.length).equals(PLAINTEXT_HEADER)
    ) {
      plaintext = stored.subarray(PLAINTEXT_HEADER.length).toString("utf-8");
      // Transparently move from the permission-only Linux fallback into a
      // real keyring if one becomes available later.
      shouldReEncrypt = await this.protection.isAvailable();
    } else {
      throw new Error(
        "The embedded PostgreSQL credential store has an unknown format",
      );
    }

    const state = parseState(plaintext);
    if (shouldReEncrypt) await this.save(state);
    return state;
  }

  private async save(state: PostgresCredentialState): Promise<void> {
    const plaintext = JSON.stringify(state);
    const protectedByOs = await this.protection.isAvailable();
    const payload = protectedByOs
      ? Buffer.concat([
          ENCRYPTED_HEADER,
          await this.protection.encrypt(plaintext),
        ])
      : Buffer.concat([PLAINTEXT_HEADER, Buffer.from(plaintext, "utf-8")]);

    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(dir, 0o700).catch(() => undefined);

    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, payload, {
        flag: "wx",
        mode: 0o600,
      });
      await fs.promises.rename(tempPath, this.filePath);
      await fs.promises.chmod(this.filePath, 0o600).catch(() => undefined);
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }
}
