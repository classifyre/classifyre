import { app, safeStorage } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { pathToFileURL } from "url";
import { getAvailablePort } from "./port-manager.js";
import { detectorWorkerCount } from "./process-manager.js";
import {
  createPostgresScramVerifier,
  LEGACY_POSTGRES_PASSWORD,
  PostgresCredentialStore,
  type CredentialProtection,
  upgradePgHbaToScram,
} from "./postgres-credentials.js";

const POSTGRES_USER = "classifyre";
const POSTGRES_DATABASE = "classifyre";

// In a packaged app, `embedded-postgres` lives in a self-contained npm tree
// staged at resources/pg/node_modules (the Forge Vite plugin ships nothing
// from the app's own node_modules — only .vite/build + package.json go into
// app.asar). In dev, the regular workspace install resolves it.
function stagedPgNodeModules(): string | null {
  if (!app.isPackaged) return null;
  const dir = path.join(process.resourcesPath, "pg", "node_modules");
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Postgres memory/planner settings, sized to the machine.
 *
 * The previous fixed `shared_buffers=256MB` was a 2005-era default that left a
 * 57 GB corpus with a 0.45% cache hit ratio on its hottest index: a single
 * dashboard count re-read 266 MB from disk on *every* execution because the
 * buffer pool could not hold one index, and read-only SELECTs were forced to
 * flush other backends' dirty pages just to find a free buffer. Worse, the
 * system catalog itself was being evicted — cold planning of a trivial count
 * measured 13.3 s against 0.068 ms warm, because a namespaced install carries
 * ~1,100 tables and ~5,000 indexes whose relcache has to be re-read from disk.
 *
 * Budget mirrors `computeApiHeapMb`: PG shares the laptop with the UI, the
 * Electron main process, the API's JS heap and the detector workers, so this
 * claims a modest slice rather than the server-class 25% rule of thumb.
 */
export function computePostgresTuning(
  totalMb: number,
  detectorWorkers: number,
): { sharedBuffersMb: number; effectiveCacheSizeMb: number } {
  // What the rest of the app has already spoken for, mirroring
  // computeApiHeapMb's reservation so the two budgets cannot double-count.
  const reservedMb = 2000 + detectorWorkers * 1200;
  const availableMb = Math.max(0, totalMb - reservedMb);
  const sharedBuffersMb = Math.max(
    256, // never regress below the previous fixed value
    Math.min(
      4096, // ceiling: past this the OS page cache serves us better than PG's
      Math.floor(availableMb * 0.25),
      Math.floor(totalMb * 0.12), // never more than an eighth of the machine
    ),
  );
  // Not an allocation — it only tells the planner how much of the table is
  // likely already cached by PG + the OS, which is what stops it from
  // discarding index plans on large tables.
  const effectiveCacheSizeMb = Math.max(
    1024,
    Math.floor((sharedBuffersMb + availableMb * 0.5) as number),
  );
  return { sharedBuffersMb, effectiveCacheSizeMb };
}

async function loadEmbeddedPostgres(): Promise<new (config: object) => object> {
  const staged = stagedPgNodeModules();
  if (staged) {
    const entry = path.join(staged, "embedded-postgres", "dist", "index.js");
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(entry).href
    )) as {
      default: new (config: object) => object;
    };
    return mod.default;
  }
  const mod = (await import("embedded-postgres")) as {
    default: new (config: object) => object;
  };
  return mod.default;
}

// The bundled PostgreSQL binaries link against ICU/OpenSSL shipped alongside
// them in the platform package's native/lib (e.g. libicuuc.so.60), but that
// directory isn't on the OS's default dynamic-loader path, so initdb aborts
// with "error while loading shared libraries: libicuuc.so.60: cannot open
// shared object file". macOS resolves its own libs via rpath and Windows via
// the bin dir, so this only needs fixing for Linux. Point LD_LIBRARY_PATH at
// the bundled lib dir before embedded-postgres spawns initdb (it inherits
// process.env).
//
// In a packaged app the platform package sits in the staged resources/pg tree
// (its native/lib next to native/bin). In dev, resolve it with a bare import —
// bun links the platform-matching package where the workspace install put it.
async function ensureBundledLibsOnLoaderPath(): Promise<void> {
  if (process.platform !== "linux") return;
  const spec =
    process.arch === "arm64"
      ? "@embedded-postgres/linux-arm64"
      : process.arch === "x64"
        ? "@embedded-postgres/linux-x64"
        : null;
  if (!spec) return;
  let libDir: string;
  const staged = stagedPgNodeModules();
  if (staged) {
    libDir = path.join(staged, spec, "native", "lib");
  } else {
    try {
      const mod = (await import(/* @vite-ignore */ spec)) as {
        initdb?: string;
      };
      if (!mod.initdb) {
        console.warn(`Platform PG package ${spec} exposed no initdb path`);
        return;
      }
      libDir = path.join(path.dirname(mod.initdb), "..", "lib");
    } catch (err) {
      console.warn(
        "Could not locate bundled PG libs for LD_LIBRARY_PATH:",
        err,
      );
      return;
    }
  }
  if (!fs.existsSync(libDir)) {
    console.warn(
      `Bundled PG lib dir not found, skipping LD_LIBRARY_PATH: ${libDir}`,
    );
    return;
  }

  // The bundled libs ship only their fully-versioned filename (e.g.
  // libicuuc.so.60.2); the SONAME symlink the loader actually searches for
  // (libicuuc.so.60) is dropped when npm packs the tarball, so initdb aborts
  // with "libicuuc.so.60: cannot open shared object file" even with libDir on
  // the path. Recreate the SONAME aliases in a writable shim dir (native/lib
  // may be read-only inside the packaged app) and put it first on the path.
  const dirs = [libDir];
  try {
    const shimDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "classifyre-pglibs-"),
    );
    for (const entry of fs.readdirSync(libDir)) {
      const soname = entry.match(/^(.+\.so\.\d+)\.\d+$/)?.[1];
      if (!soname) continue;
      try {
        fs.symlinkSync(path.join(libDir, entry), path.join(shimDir, soname));
      } catch {
        // alias already created for this SONAME — harmless
      }
    }
    dirs.unshift(shimDir);
  } catch (err) {
    console.warn("Could not build PG lib SONAME shim (continuing):", err);
  }

  const existing = process.env["LD_LIBRARY_PATH"];
  process.env["LD_LIBRARY_PATH"] = [...dirs, existing]
    .filter(Boolean)
    .join(path.delimiter);
  console.log(
    `Set LD_LIBRARY_PATH for bundled PostgreSQL libs: ${process.env["LD_LIBRARY_PATH"]}`,
  );
}

type EmbeddedPostgresInstance = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: (database?: string) => {
    connect: () => Promise<void>;
    query: (sql: string) => Promise<{ rows: unknown[] }>;
    end: () => Promise<void>;
  };
};

export class PostgresManager {
  private pg: EmbeddedPostgresInstance | null = null;
  private port = 0;
  private preferredPort = 54320;
  private running = false;
  private dataDir: string;
  private startPromise: Promise<void> | null = null;
  private password = "";
  private readonly credentialStore: PostgresCredentialStore;

  // `initdb` on a cold data dir takes a while (longer still under Rosetta), so
  // the caller can surface what the database is doing during first launch.
  constructor(
    preferredPort?: number,
    private readonly onProgress: (detail: string) => void = () => {},
    credentialStore?: PostgresCredentialStore,
  ) {
    const base = process.env["CLASSIFYRE_DATA_DIR"] || app.getPath("userData");
    this.dataDir = path.join(base, "pgdata");
    let warnedAboutFallback = false;
    const protection: CredentialProtection = {
      isAvailable: async () => {
        const linuxBackend =
          process.platform === "linux"
            ? safeStorage.getSelectedStorageBackend()
            : null;
        const available =
          linuxBackend !== "basic_text" &&
          linuxBackend !== "unknown" &&
          (await safeStorage.isAsyncEncryptionAvailable());
        if (!available && !warnedAboutFallback) {
          warnedAboutFallback = true;
          console.warn(
            "OS credential encryption is unavailable; the embedded PostgreSQL credential is protected by account-only file permissions",
          );
        }
        return available;
      },
      encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
      decrypt: async (ciphertext) => {
        const result = await safeStorage.decryptStringAsync(ciphertext);
        return {
          plaintext: result.result,
          shouldReEncrypt: result.shouldReEncrypt,
        };
      },
    };
    this.credentialStore =
      credentialStore ?? new PostgresCredentialStore(base, protection);
    if (preferredPort) this.preferredPort = preferredPort;
  }

  // Single-flight so crash recovery cannot race an in-progress startup.
  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch(async (err: unknown) => {
        await this.stopInstance().catch((stopError) =>
          console.error(
            "Embedded PostgreSQL cleanup after failed start failed:",
            stopError,
          ),
        );
        this.running = false;
        this.password = "";
        this.startPromise = null; // allow retry after a failed boot
        throw err;
      });
    }
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    if (this.running) return;

    await ensureBundledLibsOnLoaderPath();

    // Prefer the configured port; if busy, fall forward to any free port so a
    // port collision never blocks startup.
    this.port = await getAvailablePort(this.preferredPort);

    const pgVersionFile = path.join(this.dataDir, "PG_VERSION");
    const clusterExists = fs.existsSync(pgVersionFile);
    let credentials = await this.credentialStore.loadOrCreate(clusterExists);
    credentials = await this.credentialStore.stageRotationIfDue(credentials);

    // A previously migrated database already stores a SCRAM verifier, so its
    // HBA can be hardened before boot. The legacy password must be rotated
    // first; older PostgreSQL versions may have stored it as MD5.
    if (clusterExists && credentials.current !== LEGACY_POSTGRES_PASSWORD) {
      await this.hardenPgHba();
    }

    let selectedPassword = credentials.current;
    try {
      await this.bootWithPassword(selectedPassword, clusterExists);
    } catch (currentError) {
      if (!credentials.pending) throw currentError;
      console.warn(
        "Primary embedded PostgreSQL credential was rejected; recovering a pending rotation",
      );
      selectedPassword = credentials.pending;
      await this.bootWithPassword(selectedPassword, clusterExists);
    }

    await this.ensureDatabase();

    if (credentials.pending) {
      if (selectedPassword === credentials.current) {
        this.onProgress("Securing the local database credentials…");
        await this.changePassword(credentials.pending);
      }

      // Recreate the embedded-postgres wrapper with the new credential. This
      // happens before the API starts, so no live client sees a stale URL.
      await this.stopInstance();
      await this.hardenPgHba();
      await this.bootWithPassword(credentials.pending, true);
      await this.ensureDatabase();
      credentials = await this.credentialStore.commitRotation(credentials);
      console.log("Embedded PostgreSQL credential rotation completed");
    }

    this.password = credentials.current;
    this.running = true;
  }

  private postgresFlags(): string[] {
    const tuning = computePostgresTuning(
      Math.floor(os.totalmem() / (1024 * 1024)),
      detectorWorkerCount(),
    );
    return [
      // The embedded database is an implementation detail of this app. Do
      // not expose it on LAN interfaces even if host networking changes.
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "password_encryption=scram-sha-256",
      // The embedded server shares a laptop with the UI and the scan
      // pipeline; PG's server-class parallelism defaults (parallel query
      // workers, parallel index builds) otherwise pile onto an already
      // saturated machine during scans and HNSW (re)builds.
      "-c",
      "max_parallel_workers_per_gather=1",
      "-c",
      "max_parallel_maintenance_workers=1",
      "-c",
      "max_parallel_workers=2",
      "-c",
      `shared_buffers=${tuning.sharedBuffersMb}MB`,
      "-c",
      "work_mem=16MB",
      // Tells the planner how much is cached overall (PG + OS page cache).
      // Left at the 4 GB default, the planner assumed almost nothing was
      // cached and discarded index plans on the large findings tables.
      "-c",
      `effective_cache_size=${tuning.effectiveCacheSizeMb}MB`,
      // The 4.0 default models a 2005 spinning disk and biases the planner
      // *away* from index scans. Every desktop install is on SSD/NVMe.
      "-c",
      "random_page_cost=1.1",
      // Vacuum is what maintains the visibility map, and the visibility map
      // is what makes index-only scans skip the heap. At the 64 MB default,
      // a vacuum of a multi-GB table needs several index passes; at 256 MB
      // the hot tables finish in one (measured: `index scans: 1`).
      "-c",
      "maintenance_work_mem=256MB",
      // Stock autovacuum is throttled to ~2005 disk throughput and falls
      // behind ingest, which is how visibility-map coverage decayed to 36%
      // on finding_evidence_analyses and put 610k heap fetches back into
      // what should have been an index-only scan.
      "-c",
      "autovacuum_vacuum_cost_limit=2000",
      "-c",
      "autovacuum_naptime=15s",
      // A single forgotten open transaction pins the vacuum horizon and
      // makes autovacuum run continuously while reclaiming nothing.
      "-c",
      "idle_in_transaction_session_timeout=300000",
      // Stock is 100, which the API can exhaust on its own: each active
      // workspace costs up to PRISMA_POOL_MAX (16, split interactive +
      // background) plus pg-boss's own 5, so ~21 per workspace leaves room
      // for barely four before `FATAL: sorry, too many clients already` —
      // and that fails hard rather than queueing. An idle backend costs a
      // few MB of process memory, so headroom here is far cheaper than the
      // failure it prevents.
      "-c",
      "max_connections=200",
    ];
  }

  private async bootWithPassword(
    password: string,
    clusterExists: boolean,
  ): Promise<void> {
    await this.stopInstance();
    const EmbeddedPostgres = await loadEmbeddedPostgres();
    this.pg = new EmbeddedPostgres({
      databaseDir: this.dataDir,
      user: POSTGRES_USER,
      password,
      authMethod: "scram-sha-256",
      port: this.port,
      persistent: true,
      postgresFlags: this.postgresFlags(),
    }) as unknown as EmbeddedPostgresInstance;

    if (!clusterExists) {
      this.onProgress("Creating the local database for the first time…");
      await this.pg.initialise();
    }
    this.onProgress("Starting the database server…");
    await this.pg.start();

    // Starting postgres itself does not authenticate. Probe now so an
    // interrupted rotation can retry the journal's pending credential.
    const client = this.pg.getPgClient();
    try {
      await client.connect();
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async changePassword(nextPassword: string): Promise<void> {
    if (!this.pg) throw new Error("PostgreSQL not started");
    const client = this.pg.getPgClient();
    await client.connect();
    try {
      const verifier = createPostgresScramVerifier(nextPassword);
      // The verifier alphabet contains no SQL quote characters. Validate that
      // invariant before interpolation so the clear password never enters SQL.
      if (
        !/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(
          verifier,
        )
      ) {
        throw new Error("Generated an invalid PostgreSQL SCRAM verifier");
      }
      await client.query(
        `ALTER ROLE "${POSTGRES_USER}" WITH PASSWORD '${verifier}'`,
      );
    } finally {
      await client.end();
    }
  }

  private async hardenPgHba(): Promise<void> {
    const hbaPath = path.join(this.dataDir, "pg_hba.conf");
    let before: string;
    try {
      before = await fs.promises.readFile(hbaPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const after = upgradePgHbaToScram(before);
    if (after === before) return;

    const tempPath = `${hbaPath}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, after, { flag: "wx", mode: 0o600 });
      await fs.promises.rename(tempPath, hbaPath);
      await fs.promises.chmod(hbaPath, 0o600).catch(() => undefined);
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }

  private async stopInstance(): Promise<void> {
    if (!this.pg) return;
    try {
      await this.pg.stop();
    } finally {
      this.pg = null;
    }
  }

  private async ensureDatabase(): Promise<void> {
    if (!this.pg) throw new Error("PostgreSQL not started");

    const client = this.pg.getPgClient();
    await client.connect();
    try {
      const result = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DATABASE}'`,
      );
      if ((result.rows as unknown[]).length === 0) {
        await client.query(`CREATE DATABASE ${POSTGRES_DATABASE}`);
      }
    } finally {
      await client.end();
    }

    // The desktop bundle carries pgvector's extension files alongside the
    // embedded PostgreSQL runtime. Install it once in the shared database;
    // individual workspace schemas then use the public.vector type.
    const appClient = this.pg.getPgClient(POSTGRES_DATABASE);
    await appClient.connect();
    try {
      await appClient.query(
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public",
      );
    } catch (error) {
      throw new Error(
        `The bundled PostgreSQL runtime is missing pgvector: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      await appClient.end();
    }
  }

  async createSchema(schemaName: string): Promise<void> {
    if (!this.pg) throw new Error("PostgreSQL not started");
    if (!/^[a-z0-9_]+$/.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }

    // Schemas live in the app database, not the default `postgres` database.
    const client = this.pg.getPgClient(POSTGRES_DATABASE);
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    } finally {
      await client.end();
    }
  }

  async dropSchema(schemaName: string): Promise<void> {
    if (!this.pg) throw new Error("PostgreSQL not started");
    if (!/^[a-z0-9_]+$/.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }

    const client = this.pg.getPgClient(POSTGRES_DATABASE);
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await client.end();
    }
  }

  getConnectionString(schemaName?: string): string {
    if (!this.password) throw new Error("PostgreSQL credentials are not ready");
    const base = `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(this.password)}@127.0.0.1:${this.port}/${POSTGRES_DATABASE}`;
    if (!schemaName) return base;
    // `public` must stay on the search_path: pgvector lives there, and its
    // `<=>` operator is unresolvable from a schema-only path.
    const encodedOptions = encodeURIComponent(
      `-csearch_path=${schemaName},public`,
    );
    return `${base}?schema=${schemaName}&options=${encodedOptions}`;
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    // A quit can race an in-flight first start (which may take minutes on a
    // cold data dir). Wait for it so the just-spawned postgres process isn't
    // orphaned with an unflushed data dir and a stale postmaster.pid.
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // failed start — fall through and stop whatever was spawned
      }
    }
    if (!this.pg) return;
    try {
      await this.stopInstance();
    } catch (err) {
      // Best-effort, but an unclean stop can leave a stale postmaster.pid that
      // blocks the next launch — it must be visible in main.log.
      console.error("Embedded PostgreSQL shutdown failed:", err);
    }
    this.running = false;
    this.password = "";
    this.startPromise = null;
  }
}
