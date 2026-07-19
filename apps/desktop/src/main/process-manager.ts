import { spawn, execFileSync, type ChildProcess } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import http from "http";
import os from "os";
import crypto from "crypto";
import treeKill from "tree-kill";
import { ensurePythonRuntime } from "./python-env.js";
import { getLogFilePath } from "./logger.js";
import { RESERVED_ENV_KEYS } from "./namespace-manager.js";

function sanitizeCustomEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (RESERVED_ENV_KEYS.has(key.toUpperCase())) continue;
    if (typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

// In dev mode we inherit the developer's login-shell PATH so locally installed
// tooling (uv, java, node) is visible. In packaged mode we never touch the
// user's shell: everything the app needs is bundled, and the PATH is built
// from the bundled resources plus standard system directories only.
function getDevShellPath(): string {
  const shells = ["/bin/zsh", "/bin/bash"];
  for (const shell of shells) {
    try {
      if (!fs.existsSync(shell)) continue;
      const raw = execFileSync(shell, ["-lc", "echo $PATH"], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (raw) return raw;
    } catch {
      /* fall through */
    }
  }

  const home = os.homedir();
  return [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

function getSystemPath(): string {
  if (process.platform === "win32") {
    return process.env["PATH"] ?? "";
  }
  return ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
}

let cachedEnv: Record<string, string> | null = null;

function getBaseEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv;
  if (app.isPackaged) {
    cachedEnv = {
      ...process.env,
      PATH: getSystemPath(),
    } as Record<string, string>;
    // The packaged app must not run child processes as Node accidentally.
    delete cachedEnv["ELECTRON_RUN_AS_NODE"];
  } else {
    cachedEnv = { ...process.env, PATH: getDevShellPath() } as Record<
      string,
      string
    >;
  }
  return cachedEnv;
}

// The API refuses to boot with NODE_ENV=production unless a masked-config
// encryption key is set (it encrypts source credentials at rest). Desktop has
// no deployment config, so generate a random 32-byte key once per install and
// persist it in userData — it must stay stable or previously saved source
// credentials become undecryptable.
let cachedMaskedConfigKey: string | null = null;

function getMaskedConfigKey(): string {
  if (cachedMaskedConfigKey) return cachedMaskedConfigKey;
  const keyFile = path.join(app.getPath("userData"), "masked-config.key");
  try {
    const existing = fs.readFileSync(keyFile, "utf-8").trim();
    if (existing) {
      cachedMaskedConfigKey = existing;
      return existing;
    }
  } catch {
    // first run — generate below
  }
  const key = `base64:${crypto.randomBytes(32).toString("base64")}`;
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  cachedMaskedConfigKey = key;
  return key;
}

// Optional detector/source dependency groups install on first use via
// `uv sync --group X`, so uv's download/wheel cache grows over time. Left at
// uv's OS default (~/.cache/uv, ~/Library/Caches/uv, %LOCALAPPDATA%\uv\cache)
// it would pollute the user's global cache and grow unbounded. Contain it under
// userData so it is isolated per install, wiped on uninstall/reset, and can be
// size-capped by us. Dev keeps uv's global cache for fast iteration.
function getUvCacheDir(): string | null {
  if (!app.isPackaged) return null;
  return path.join(app.getPath("userData"), "uv-cache");
}

// Scan (runner) logs are persisted as NDJSON files per run, namespaced so
// separate workspaces never mix logs. Sits under CLASSIFYRE_DATA_DIR/userData
// alongside the Postgres data so uninstall/reset wipes it too.
function getRunnerLogDir(namespaceId: string): string {
  const base = process.env["CLASSIFYRE_DATA_DIR"] || app.getPath("userData");
  return path.join(base, "runner-logs", namespaceId);
}

// Hard cap for the contained uv cache. Once exceeded we wipe it (equivalent to
// `uv cache clean` for a cache dir we fully own — uv rebuilds it on next sync)
// rather than a soft prune, which only drops unreferenced entries and lets the
// cache creep past the cap. Kept modest since this lives on the user's machine.
const UV_CACHE_MAX_BYTES = 4 * 1024 ** 3; // 4 GiB

// Recursive directory size with early exit: stops walking as soon as the
// running total passes `limit`, so an oversized cache is detected without
// traversing the whole tree. Cross-platform (no `du`). Best-effort. Async so
// a large cache walk never blocks the Electron main process.
async function dirSizeExceeds(dir: string, limit: number): Promise<boolean> {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += (await fs.promises.stat(full)).size;
        } catch {
          continue;
        }
        if (total > limit) return true;
      }
    }
  }
  return false;
}

export interface ApiRuntimeOptions {
  maxParallelScans?: number;
  memoryLimitMb?: number;
  /** Custom env vars (already validated against RESERVED_ENV_KEYS at save time). */
  env?: Record<string, string>;
}

interface ManagedProcess {
  child: ChildProcess;
  port: number;
}

// Unexpected API death (native crash, external kill) is respawned so the
// workspace heals without the user reopening it — but bounded, so a
// crash-on-boot bug degrades to a logged failure instead of a spawn loop.
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_RESTARTS_PER_WINDOW = 3;
const RESTART_DELAY_MS = 2000;

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private restartTimestamps = new Map<string, number[]>();
  private venvPathOverride: string | null = null;
  private venvPreparation: Promise<void> | null = null;
  private apiDirPromise: Promise<string> | null = null;

  // Rewires the bundled Python venv for this machine. Lazy: runs on the first
  // workspace open (covered by the loading indicator) rather than at app
  // startup — the first-launch copy can move gigabytes.
  // Single-flight: a second workspace opened during the first-launch copy must
  // await the same preparation, not race ahead with an unpatched venv path.
  private prepareVenv(): Promise<void> {
    if (!this.venvPreparation) {
      this.venvPreparation = (async () => {
        try {
          const venvPath = await ensurePythonRuntime();
          if (venvPath) this.venvPathOverride = venvPath;
        } catch (err) {
          console.error("Failed to prepare Python runtime:", err);
        }
        await this.bustUvCacheIfOversized();
      })();
    }
    return this.venvPreparation;
  }

  // Keep the contained uv cache under its size cap. Runs once per app launch
  // alongside venv prep (which is already covered by the loading indicator).
  // Best-effort: cache maintenance must never block or fail a workspace open.
  private async bustUvCacheIfOversized(): Promise<void> {
    const cacheDir = getUvCacheDir();
    if (!cacheDir) return;
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        return;
      }
      if (await dirSizeExceeds(cacheDir, UV_CACHE_MAX_BYTES)) {
        console.log(
          `[uv-cache] ${cacheDir} exceeds ${UV_CACHE_MAX_BYTES} bytes — clearing`,
        );
        await fs.promises.rm(cacheDir, { recursive: true, force: true });
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    } catch (err) {
      console.error("Failed to maintain uv cache:", err);
    }
  }

  // On macOS the API tree ships as ONE api.tar.gz (its ~65k node_modules
  // files made Apple's notary scan take hours) and is unpacked to userData on
  // first workspace open, once per app version. Other platforms bundle the
  // plain resources/api directory.
  // Single-flight and fully async: the extraction can take tens of seconds and
  // must never run on the main thread synchronously (it froze the whole app —
  // macOS flagged it unresponsive during the first workspace open).
  private ensureApiDir(): Promise<string> {
    if (!this.apiDirPromise) {
      this.apiDirPromise = this.extractApiDir().catch((err: unknown) => {
        // Allow a retry on the next workspace open instead of caching failure.
        this.apiDirPromise = null;
        throw err;
      });
    }
    return this.apiDirPromise;
  }

  private async extractApiDir(): Promise<string> {
    const bundledDir = path.join(process.resourcesPath, "api");
    const archive = path.join(process.resourcesPath, "api.tar.gz");
    if (fs.existsSync(bundledDir) || !fs.existsSync(archive)) {
      return bundledDir;
    }

    const root = path.join(app.getPath("userData"), "api-runtime");
    const markerFile = path.join(root, "version.json");
    const extractedDir = path.join(root, "api");

    // Re-extract whenever the bundled archive changes, not just when the app
    // version string changes. Gating purely on app.getVersion() leaves a stale
    // API running whenever the archive is rebuilt under the same version (e.g.
    // every -SNAPSHOT dev/test iteration), which silently ships old backend code.
    // The signature also forces a fresh extract after a partial/corrupt unpack.
    const archiveStat = fs.statSync(archive);
    const signature = `${app.getVersion()}:${archiveStat.size}:${Math.round(archiveStat.mtimeMs)}`;
    try {
      const marker = JSON.parse(
        await fs.promises.readFile(markerFile, "utf-8"),
      ) as { signature?: string };
      if (marker.signature === signature && fs.existsSync(extractedDir)) {
        return extractedDir;
      }
    } catch {
      // no valid extraction yet
    }

    console.log(`[api-runtime] Extracting bundled API to ${root}…`);
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.mkdir(root, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tar", ["-xzf", archive, "-C", root], {
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`Failed to extract bundled API (tar exited ${code})`),
          );
      });
    });
    await fs.promises.writeFile(markerFile, JSON.stringify({ signature }));
    console.log("[api-runtime] Extraction complete");
    return extractedDir;
  }

  private async getApiEntryPath(): Promise<string> {
    if (app.isPackaged) {
      // Packaged: the whole API is one esbuild bundle at the api-tree root
      // (see apps/desktop/scripts/bundle-api.mjs). Dev still runs the plain
      // tsc output.
      return path.join(await this.ensureApiDir(), "backend.js");
    }
    return path.join(__dirname, "../../../api/dist/src/main.js");
  }

  private getCliPath(): string {
    if (app.isPackaged) {
      // pyapp mirrors the monorepo layout (apps/cli + packages/schemas) so the
      // CLI pyproject's relative editable dep stays valid for runtime uv sync.
      return path.join(process.resourcesPath, "pyapp", "apps", "cli");
    }
    return path.join(__dirname, "../../../cli");
  }

  private getVenvPath(): string {
    if (this.venvPathOverride) return this.venvPathOverride;
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "venv");
    }
    return path.join(__dirname, "../../../cli/.venv");
  }

  private async getPrismaDir(): Promise<string> {
    if (app.isPackaged) {
      // Staged inside the api tree so `prisma generate` at build time and
      // `prisma migrate deploy` at runtime share one schema location.
      return path.join(await this.ensureApiDir(), "prisma");
    }
    return path.join(__dirname, "../../../api/prisma");
  }

  private async getApiDir(): Promise<string> {
    if (app.isPackaged) {
      return this.ensureApiDir();
    }
    return path.join(__dirname, "../../../api");
  }

  // Runs a script with Electron's embedded Node.js so the packaged app never
  // depends on a system-wide node installation.
  private nodeSpawnEnv(extra: Record<string, string>): Record<string, string> {
    return {
      ...getBaseEnv(),
      ...extra,
      ELECTRON_RUN_AS_NODE: "1",
    };
  }

  async startApi(
    namespaceId: string,
    port: number,
    databaseUrl: string,
    options: ApiRuntimeOptions = {},
  ): Promise<void> {
    if (this.processes.has(namespaceId)) {
      return;
    }

    await this.prepareVenv();
    const entryPath = await this.getApiEntryPath();
    const cliPath = this.getCliPath();
    const venvPath = this.getVenvPath();

    const baseEnv = getBaseEnv();

    const venvBin = path.join(
      venvPath,
      process.platform === "win32" ? "Scripts" : "bin",
    );
    const pathWithVenv = fs.existsSync(venvBin)
      ? `${venvBin}${path.delimiter}${baseEnv["PATH"] ?? ""}`
      : (baseEnv["PATH"] ?? "");

    const nodeArgs: string[] = [];
    if (options.memoryLimitMb && options.memoryLimitMb > 0) {
      nodeArgs.push(
        `--max-old-space-size=${Math.floor(options.memoryLimitMb)}`,
      );
    }

    const child = spawn(process.execPath, [...nodeArgs, entryPath], {
      env: {
        ...baseEnv,
        PATH: pathWithVenv,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        // NamespaceRuntime has already completed migrate deploy before this
        // process is spawned. Keep the API's standalone migration fallback off
        // here so every workspace open does not invoke Prisma twice.
        CLASSIFYRE_AUTO_MIGRATE: "false",
        ENVIRONMENT: "desktop",
        CLI_PATH: cliPath,
        VENV_PATH: venvPath,
        // Pin uv's project environment to the (possibly relocated) venv so
        // `uv run` / on-demand `uv sync --group X` target it instead of
        // creating .venv inside the read-only bundled CLI directory. Only the
        // base deps are baked; optional detector/source groups install on
        // first use, so auto-install must stay enabled (it defaults to on).
        UV_PROJECT_ENVIRONMENT: venvPath,
        // Contain uv's download/wheel cache under userData (see getUvCacheDir).
        // The API spawns the CLI via `uv run` / `uv sync --group X`, which
        // inherit this env, so pinning it here covers every child uv invocation.
        ...(getUvCacheDir() ? { UV_CACHE_DIR: getUvCacheDir() as string } : {}),
        CLASSIFYRE_MASKED_CONFIG_KEY: getMaskedConfigKey(),
        // Persist scan logs on the local filesystem (desktop has no S3).
        // The storage service enforces per-run and total-size caps itself.
        RUNNER_LOG_DIR: getRunnerLogDir(namespaceId),
        EMBEDDING_CACHE_DIR: app.isPackaged
          ? path.join(process.resourcesPath, "models", "transformers")
          : path.join(app.getPath("userData"), "transformers-cache"),
        ...(app.isPackaged
          ? {
              EMBEDDING_ALLOW_REMOTE_MODELS: "false",
            }
          : {}),
        CORS_ORIGIN: "*",
        NODE_ENV: app.isPackaged ? "production" : "development",
        ...(options.maxParallelScans && options.maxParallelScans > 0
          ? {
              // MAX_CONCURRENT_RUNNERS is the name the API actually reads;
              // MAX_PARALLEL_SCANS is kept for older bundled API builds.
              MAX_PARALLEL_SCANS: String(Math.floor(options.maxParallelScans)),
              MAX_CONCURRENT_RUNNERS: String(
                Math.floor(options.maxParallelScans),
              ),
            }
          : {}),
        // Workspace-level custom env (embedding model, runner limits, feature
        // flags…). Spread last so user overrides win over the tunable defaults
        // above; keys that would break the runtime are rejected at save time
        // and defensively stripped here (namespaces.json is hand-editable).
        ...sanitizeCustomEnv(options.env),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      process.stderr.write(`[API:${namespaceId}] ${data.toString().trim()}\n`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[API:${namespaceId}] ${data.toString().trim()}\n`);
    });

    child.on("exit", (code, signal) => {
      process.stderr.write(
        `[API:${namespaceId}] exited with code ${code}${signal ? ` (signal ${signal})` : ""}\n`,
      );
      // stopApi removes the entry from the map before killing; if this child
      // is still the registered one, nobody asked it to die — respawn it.
      const current = this.processes.get(namespaceId);
      if (!current || current.child !== child) return;
      this.processes.delete(namespaceId);
      this.scheduleRestart(namespaceId, port, databaseUrl, options);
    });

    // Without an 'error' listener a failed spawn (ENOENT/EACCES from a
    // corrupted install, AV quarantine, missing entry file) throws an uncaught
    // exception in the main process and crashes the whole app. Surface it as a
    // failed workspace open instead, without waiting out the ready timeout.
    const spawnFailed = new Promise<never>((_, reject) => {
      child.on("error", (err) => {
        process.stderr.write(
          `[API:${namespaceId}] process error: ${err.message}\n`,
        );
        reject(new Error(`Failed to launch the API process: ${err.message}`));
      });
    });
    spawnFailed.catch(() => {}); // late errors are logged above, not rethrown

    this.processes.set(namespaceId, { child, port });

    try {
      await Promise.race([this.waitForReady(port), spawnFailed]);
    } catch (err) {
      await this.stopApi(namespaceId);
      throw err;
    }
  }

  // Locates the Prisma CLI bundled with the API's node_modules; runs offline
  // with Electron's Node — no bun, no npx, no network.
  private async getPrismaCliPath(): Promise<string> {
    const candidates = [
      path.join(
        await this.getApiDir(),
        "node_modules",
        "prisma",
        "build",
        "index.js",
      ),
      // Dev fallback: hoisted install at the monorepo root.
      path.join(__dirname, "../../../../node_modules/prisma/build/index.js"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
      `Prisma CLI not found (looked in: ${candidates.join(", ")}). ` +
        "The desktop bundle must include api/node_modules/prisma.",
    );
  }

  async runMigrations(databaseUrl: string): Promise<void> {
    const prismaSchemaPath = path.join(
      await this.getPrismaDir(),
      "schema.prisma",
    );
    const apiDir = await this.getApiDir();
    const prismaCli = await this.getPrismaCliPath();

    console.log(
      `[migrations] Running in ${apiDir} with schema ${prismaSchemaPath}`,
    );

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [prismaCli, "migrate", "deploy", "--schema", prismaSchemaPath],
        {
          cwd: apiDir,
          env: this.nodeSpawnEnv({
            DATABASE_URL: databaseUrl,
            // Prisma CLI must not try to download engines at runtime.
            PRISMA_CLI_TELEMETRY_INFORMATION: "disabled",
            CHECKPOINT_DISABLE: "1",
          }),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stderr = "";
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Prisma migrate failed (code ${code}): ${stderr}`));
        }
      });

      child.on("error", reject);
    });
  }

  private waitForReady(
    port: number,
    // The FIRST workspace open does heavy one-time work before the API binds
    // its port — pg-boss creates its whole schema, Nest wires every module, and
    // on macOS the embedded Postgres runs under Rosetta. 60s was too tight for
    // that cold start (users hit "not ready after 60000ms" on first launch);
    // warm opens are ~2s, so a generous ceiling only affects the cold case and
    // resolves the instant the API is up.
    timeoutMs = 180_000,
    intervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          const logFile = getLogFilePath();
          reject(
            new Error(
              `API on port ${port} not ready after ${timeoutMs}ms` +
                (logFile ? ` — see log for details: ${logFile}` : ""),
            ),
          );
          return;
        }

        const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            setTimeout(check, intervalMs);
          }
          res.resume();
        });

        req.on("error", () => {
          setTimeout(check, intervalMs);
        });

        req.setTimeout(2000, () => {
          req.destroy();
          setTimeout(check, intervalMs);
        });
      };

      check();
    });
  }

  private scheduleRestart(
    namespaceId: string,
    port: number,
    databaseUrl: string,
    options: ApiRuntimeOptions,
  ): void {
    const now = Date.now();
    const recent = (this.restartTimestamps.get(namespaceId) ?? []).filter(
      (at) => now - at < RESTART_WINDOW_MS,
    );
    if (recent.length >= MAX_RESTARTS_PER_WINDOW) {
      process.stderr.write(
        `[API:${namespaceId}] crashed ${recent.length} times in ${RESTART_WINDOW_MS / 60000} minutes; not restarting again\n`,
      );
      return;
    }
    recent.push(now);
    this.restartTimestamps.set(namespaceId, recent);
    process.stderr.write(
      `[API:${namespaceId}] restarting in ${RESTART_DELAY_MS}ms (attempt ${recent.length}/${MAX_RESTARTS_PER_WINDOW})\n`,
    );
    setTimeout(() => {
      // The workspace may have been closed or reopened while we waited.
      if (this.processes.has(namespaceId)) return;
      this.startApi(namespaceId, port, databaseUrl, options).catch((err) => {
        process.stderr.write(
          `[API:${namespaceId}] restart failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }, RESTART_DELAY_MS);
  }

  async stopApi(namespaceId: string): Promise<void> {
    const managed = this.processes.get(namespaceId);
    if (!managed) return;

    this.processes.delete(namespaceId);

    return new Promise<void>((resolve) => {
      const { child } = managed;
      const pid = child.pid;
      if (!pid) {
        resolve();
        return;
      }

      const forceKillTimer = setTimeout(() => {
        treeKill(pid, "SIGKILL", () => resolve());
      }, 5000);

      child.on("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      treeKill(pid, "SIGTERM");
    });
  }

  async stopAll(): Promise<void> {
    const ids = [...this.processes.keys()];
    await Promise.all(ids.map((id) => this.stopApi(id)));
  }

  getPort(namespaceId: string): number | undefined {
    return this.processes.get(namespaceId)?.port;
  }

  isRunning(namespaceId: string): boolean {
    return this.processes.has(namespaceId);
  }

  getRunningNamespaces(): string[] {
    return [...this.processes.keys()];
  }
}
