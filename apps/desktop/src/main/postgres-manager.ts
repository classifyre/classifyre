import { app } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { pathToFileURL } from "url";
import { getAvailablePort } from "./port-manager.js";

// In a packaged app, `embedded-postgres` lives in a self-contained npm tree
// staged at resources/pg/node_modules (the Forge Vite plugin ships nothing
// from the app's own node_modules — only .vite/build + package.json go into
// app.asar). In dev, the regular workspace install resolves it.
function stagedPgNodeModules(): string | null {
  if (!app.isPackaged) return null;
  const dir = path.join(process.resourcesPath, "pg", "node_modules");
  return fs.existsSync(dir) ? dir : null;
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

  constructor(preferredPort?: number) {
    const base = process.env["CLASSIFYRE_DATA_DIR"] || app.getPath("userData");
    this.dataDir = path.join(base, "pgdata");
    if (preferredPort) this.preferredPort = preferredPort;
  }

  // Single-flight: concurrent callers (app boot + an early namespace:open)
  // share one startup, and none observes "running" until the classifyre
  // database exists — otherwise a fast createSchema() races ensureDatabase()
  // and dies with 'database "classifyre" does not exist'.
  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch((err: unknown) => {
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

    const EmbeddedPostgres = await loadEmbeddedPostgres();
    this.pg = new EmbeddedPostgres({
      databaseDir: this.dataDir,
      user: "classifyre",
      password: "classifyre",
      port: this.port,
      persistent: true,
      // The embedded server shares a laptop with the UI and the scan
      // pipeline; PG's server-class parallelism defaults (parallel query
      // workers, parallel index builds) otherwise pile onto an already
      // saturated machine during scans and HNSW (re)builds.
      postgresFlags: [
        "-c", "max_parallel_workers_per_gather=1",
        "-c", "max_parallel_maintenance_workers=1",
        "-c", "max_parallel_workers=2",
        "-c", "shared_buffers=256MB",
        "-c", "work_mem=16MB",
      ],
    }) as unknown as EmbeddedPostgresInstance;

    const pgVersionFile = path.join(this.dataDir, "PG_VERSION");
    if (!fs.existsSync(pgVersionFile)) {
      await this.pg.initialise();
    }
    await this.pg.start();
    await this.ensureDatabase();
    this.running = true;
  }

  private async ensureDatabase(): Promise<void> {
    if (!this.pg) throw new Error("PostgreSQL not started");

    const client = this.pg.getPgClient();
    await client.connect();
    try {
      const result = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'classifyre'",
      );
      if ((result.rows as unknown[]).length === 0) {
        await client.query("CREATE DATABASE classifyre");
      }
    } finally {
      await client.end();
    }

    // The desktop bundle carries pgvector's extension files alongside the
    // embedded PostgreSQL runtime. Install it once in the shared database;
    // individual workspace schemas then use the public.vector type.
    const appClient = this.pg.getPgClient("classifyre");
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
    const client = this.pg.getPgClient("classifyre");
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

    const client = this.pg.getPgClient("classifyre");
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await client.end();
    }
  }

  getConnectionString(schemaName?: string): string {
    const base = `postgresql://classifyre:classifyre@127.0.0.1:${this.port}/classifyre`;
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
      await this.pg.stop();
    } catch (err) {
      // Best-effort, but an unclean stop can leave a stale postmaster.pid that
      // blocks the next launch — it must be visible in main.log.
      console.error("Embedded PostgreSQL shutdown failed:", err);
    }
    this.running = false;
    this.pg = null;
    this.startPromise = null;
  }
}
