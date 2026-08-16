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
import { gitEnv } from "./git-env.js";
import { sofficeEnv } from "./soffice-env.js";

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

// Shared secret the API uses to tell its own CLI scan jobs apart from any other
// caller, gating the ingest write-back endpoints. On desktop the API binds to
// loopback, so this is defence in depth rather than the primary boundary — but
// the CLI is spawned as a child of the API and inherits its environment, so
// wiring it here costs nothing and keeps every deployment on one code path.
// Persisted per install: it need not survive, but a stable value avoids
// invalidating a scan that is running across a restart.
let cachedInternalKey: string | null = null;

function getInternalApiKey(): string {
  if (cachedInternalKey) return cachedInternalKey;
  const keyFile = path.join(app.getPath("userData"), "internal-api.key");
  try {
    const existing = fs.readFileSync(keyFile, "utf-8").trim();
    if (existing) {
      cachedInternalKey = existing;
      return existing;
    }
  } catch {
    // first run — generate below
  }
  const key = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  cachedInternalKey = key;
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

// Scan logs are persisted as NDJSON files per run under userData.
function getRunnerLogDir(): string {
  const base = process.env["CLASSIFYRE_DATA_DIR"] || app.getPath("userData");
  return path.join(base, "runner-logs");
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

interface ManagedProcess {
  child: ChildProcess;
  port: number;
}

// Desktop resource governor: the laptop also runs the UI, embedded Postgres,
// and the user's other apps, so the scan pipeline must never size itself to
// the whole machine (the CLI pool auto-sizes to cores-1 when unconstrained,
// which froze the host during scans).
export function detectorWorkerCount(): number {
  const cores = os.cpus().length;
  return Math.max(1, Math.min(4, Math.floor(cores / 2) - 1));
}

export function namespaceJobConcurrency(): number {
  // How many workspaces may run background jobs at once.
  //
  // The API default is 4, sized for Kubernetes where each worker is its own
  // pod with its own memory limit. Desktop is the opposite: SERVICE_ROLE
  // defaults to `all`, so one process serves every workspace, and each
  // namespace job spawns a CLI with its own detector pool. At the default that
  // is up to 4 × CLASSIFYRE_MAX_POOL_WORKERS resident Python workers (~1 GB
  // apiece for spaCy + torch) plus four ingest streams allocating into one
  // shared V8 heap — measured on a laptop as a sawtooth from 384 MB to
  // 3435 MB every ~90 seconds, with `sec-edgar acquired slot 4/4` while other
  // workspaces queued behind it.
  //
  // Two keeps a workspace making progress while another is busy, without
  // letting the machine's memory be claimed four times over.
  const cores = os.cpus().length;
  return cores >= 12 ? 3 : 2;
}

function resourceDefaultEnv(): Record<string, string> {
  const cores = os.cpus().length;
  const detectorWorkers = detectorWorkerCount();
  return {
    // Detector process pool: at most half the machine, and 2 BLAS/torch
    // threads per worker so workers*threads stays well under core count.
    CLASSIFYRE_MAX_POOL_WORKERS: String(detectorWorkers),
    CLASSIFYRE_WORKER_THREADS: "2",
    MAX_CONCURRENT_NAMESPACE_JOBS: String(namespaceJobConcurrency()),
    // Embedding inference: small batches, few threads — throughput matters
    // less than the machine staying responsive.
    EMBEDDING_BATCH_SIZE: "8",
    EMBEDDING_INTRA_OP_THREADS: cores >= 8 ? "2" : "1",
    // Scan concurrency is deliberately NOT set here. It is a per-workspace
    // setting (Workspace settings → Scanning), so a small workspace and a
    // 151-source one on the same machine can differ; pinning the environment
    // variable would override every workspace and make the control inert.
  };
}

/**
 * Hard ceiling Electron enforces on `--max-old-space-size` under
 * ELECTRON_RUN_AS_NODE. Requests above this are silently clamped: asking for
 * 6144 or 12288 both yield a real `heap_size_limit` of ~4192 MB. Never return
 * a value the runtime cannot grant — the gap is invisible at runtime and
 * anything derived from the request (notably the shed threshold) is then wrong.
 */
export const ELECTRON_MAX_OLD_SPACE_MB = 4096;

/**
 * Sizes the API's V8 old-space cap for this machine.
 *
 * Counter-intuitively, bigger is worse here. V8 sizes its collection schedule
 * against the ceiling it is given, so a large cap means garbage accumulates
 * near that cap before a major GC runs. Measured on a 34 GB laptop mid-scan:
 * `old_space` parked at ~3.1 GB while a forced full GC dropped the heap to
 * 174 MB — over 90% of it was collectable. Those cold garbage pages are not
 * free: `rss` was 414 MB against a 3237 MB heap because macOS had compressed
 * and swapped the rest out, and an allocation eventually failed under that
 * pressure and aborted the process with SIGABRT.
 *
 * So the cap is a GC-frequency dial, not a workload budget. The live set of a
 * normal scan is a few hundred MB, and the default below buys headroom over
 * that and nothing more. The Helm chart runs each pod at 1536 MB in
 * production; desktop gets more because one process is both roles
 * (SERVICE_ROLE defaults to `all`, so the HTTP API and every pg-boss worker
 * share this heap) — but nothing near what the machine could afford, because
 * affording it is what caused the crash.
 *
 * A very large workspace can still exceed this: reading a correlation graph
 * snapshot expands a 25 MB JSONB payload (58k nodes / 252k edges on a real
 * corpus) into a ~233 MB JSON string plus its parsed object tree, and that is
 * genuinely live for the duration of the request. Rather than paying for that
 * worst case on every install, the ceiling is raisable per machine from the
 * Settings ▸ API Memory Limit menu (persisted as `memoryLimitMb`), which is
 * what `overrideMb` carries here.
 */
export const DEFAULT_API_HEAP_MB = 2048;

export function computeApiHeapMb(
  totalMb: number,
  detectorWorkers: number,
  overrideMb?: number,
): number {
  if (overrideMb && overrideMb > 0) {
    return Math.min(Math.floor(overrideMb), ELECTRON_MAX_OLD_SPACE_MB);
  }
  // Small machines still have to leave room for the renderer, embedded
  // Postgres and one resident Python detector worker per pool slot (spaCy +
  // torch are ~1 GB apiece); large machines gain nothing from a bigger heap.
  const reservedMb = 2000 + detectorWorkers * 1200;
  return Math.max(
    1024,
    Math.min(
      DEFAULT_API_HEAP_MB,
      Math.max(totalMb - reservedMb, 0),
      Math.floor(totalMb * 0.35),
    ),
  );
}

// Unexpected API death (native crash, external kill) is respawned so the
// service heals without the user restarting the app — but bounded, so a
// crash-on-boot bug degrades to a logged failure instead of a spawn loop.
export const RESTART_WINDOW_MS = 10 * 60 * 1000;
export const MAX_RESTARTS_PER_WINDOW = 3;
const RESTART_DELAY_MS = 2000;
/**
 * How long a generation must have served before its death is judged on its own
 * rather than as part of the burst that preceded it.
 *
 * This is measured at crash time from the generation's actual uptime, not by a
 * timer. A timer cannot work here: the previous design armed one for 20
 * minutes — twice {@link RESTART_WINDOW_MS} — so a service that recovered and
 * ran for eight minutes never earned its reset, while the three crash
 * timestamps from a burst nine minutes earlier were all still inside the
 * window. The fourth crash then retired the API permanently, on a machine that
 * had just demonstrated it could serve for eight minutes at a stretch. That is
 * the "stopped 3 times in 10 minutes and is no longer being restarted" dialog
 * appearing over a working system.
 *
 * Well above the readiness probe's cold-start ceiling (~100 s on a loaded
 * database), so a slow boot is never mistaken for a healthy run.
 */
export const HEALTHY_RUN_MS = 5 * 60 * 1000;

export interface RestartDecision {
  /** Whether to respawn. False means the budget is spent. */
  restart: boolean;
  /** Crash timestamps to carry forward. */
  crashes: number[];
  /** 1-based attempt number within the window, when restarting. */
  attempt: number;
}

/**
 * Whether a crashed API generation earns a respawn.
 *
 * Pure so the budget can be tested without spawning anything — the failure it
 * guards against (a permanently disabled service) only shows up after a
 * specific sequence of crashes minutes apart.
 */
export function restartDecision(input: {
  now: number;
  crashes: readonly number[];
  uptimeMs: number;
}): RestartDecision {
  const inWindow = input.crashes.filter(
    (at) => input.now - at < RESTART_WINDOW_MS,
  );
  // A generation that served for a real stretch is proof this is not a crash
  // loop on boot, so the earlier burst stops counting against it.
  const recent = input.uptimeMs >= HEALTHY_RUN_MS ? [] : inWindow;

  if (recent.length >= MAX_RESTARTS_PER_WINDOW) {
    return { restart: false, crashes: recent, attempt: recent.length };
  }
  return {
    restart: true,
    crashes: [...recent, input.now],
    attempt: recent.length + 1,
  };
}

/**
 * Coarse phase an API start is in: local preparation work (relocating the
 * bundled venv, unpacking the API tree) versus the service itself booting.
 */
export type ApiStartupPhase = "runtime" | "service";

export type ApiStartupProgress = (
  detail: string,
  phase: ApiStartupPhase,
) => void;

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private restartTimestamps = new Map<string, number[]>();
  private venvPathOverride: string | null = null;
  private venvPreparation: Promise<void> | null = null;
  private apiDirPromise: Promise<string> | null = null;
  private started = new Set<string>();
  private reportProgress = true;

  // First-launch preparation (venv relocation, API unpacking) runs for minutes
  // with nothing else to show for it, so the caller can surface it to the user.
  // onUnavailable fires when the restart budget is spent and the API is staying
  // down, so the UI can say so instead of looping on connection-refused.
  constructor(
    private readonly onProgress: ApiStartupProgress = () => {},
    private readonly memoryLimitMb: number = 0,
    private readonly onUnavailable: (
      processId: string,
      reason: string,
    ) => void = () => {},
  ) {}

  private progress(detail: string, phase: ApiStartupPhase): void {
    if (this.reportProgress) this.onProgress(detail, phase);
  }

  // Rewires the bundled Python venv for this machine before the shared API
  // starts. Single-flight so crash recovery cannot race the first preparation.
  private prepareVenv(): Promise<void> {
    if (!this.venvPreparation) {
      this.venvPreparation = (async () => {
        try {
          this.progress("Preparing the bundled Python runtime…", "runtime");
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
  // Best-effort: cache maintenance must never fail API startup.
  private async bustUvCacheIfOversized(): Promise<void> {
    const cacheDir = getUvCacheDir();
    if (!cacheDir) return;
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        return;
      }
      if (await dirSizeExceeds(cacheDir, UV_CACHE_MAX_BYTES)) {
        this.progress("Clearing the package cache…", "runtime");
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
  // first API start, once per app version. Other platforms bundle the
  // plain resources/api directory.
  // Single-flight and fully async: the extraction can take tens of seconds and
  // must never run on the main thread synchronously (it froze the whole app —
  // macOS flagged it unresponsive during first startup).
  private ensureApiDir(): Promise<string> {
    if (!this.apiDirPromise) {
      this.apiDirPromise = this.extractApiDir().catch((err: unknown) => {
        // Allow a retry on the next API start instead of caching failure.
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

    this.progress("Unpacking application components…", "runtime");
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

  async startApi(
    processId: string,
    port: number,
    databaseUrl: string,
    // Set by scheduleRestart. A failed *first* start is fatal and surfaces to
    // the startup window; a failed restart is retried against the budget.
    isRestart = false,
  ): Promise<void> {
    if (this.processes.has(processId)) {
      return;
    }

    // A crash-restart runs concurrently with the original start's readiness
    // wait, so only the first attempt reports progress — otherwise two elapsed
    // counters interleave and the UI appears to count backwards.
    if (this.started.has(processId)) this.reportProgress = false;
    this.started.add(processId);

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

    // JS heap cap. Electron's default old-space limit is both small and
    // unreliable under ELECTRON_RUN_AS_NODE, so pin it explicitly — see
    // computeApiHeapMb for how the value is budgeted. `memoryLimitMb` in
    // settings.json overrides it for corpora that need more.
    const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
    const heapMb = computeApiHeapMb(
      totalMb,
      detectorWorkerCount(),
      this.memoryLimitMb,
    );
    const nodeArgs: string[] = [`--max-old-space-size=${heapMb}`];
    // The shed threshold is deliberately NOT computed here. It used to be
    // 85% of the value requested above, which is only correct if Electron
    // grants that request — it does not above ~4 GB, so the guard was set
    // beyond the ceiling V8 enforced and never fired. The API derives it from
    // v8.getHeapStatistics() at boot instead (see utils/heap-guard.ts), which
    // is right on every machine, OS and container without anything to keep in
    // sync here.

    const child = spawn(process.execPath, [...nodeArgs, entryPath], {
      env: {
        ...baseEnv,
        PATH: pathWithVenv,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        // Child CLI processes receive a complete namespace URL built from this
        // API-owned base, matching the Kubernetes job contract.
        CLASSIFYRE_INTERNAL_API_URL: `http://127.0.0.1:${port}`,
        DATABASE_URL: databaseUrl,
        // The shared API owns the registry and every namespace schema.
        CLASSIFYRE_AUTO_MIGRATE: "true",
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
        // Inherited by every CLI process the API spawns via `uv run`, which is
        // how scan jobs authenticate their write-backs.
        CLASSIFYRE_INTERNAL_KEY: getInternalApiKey(),
        // Legacy Office (.doc/.xls/.ppt) extraction shells out to a system
        // LibreOffice, which the desktop bundle does not ship (see soffice-env.ts).
        ...sofficeEnv(),
        // Git-repository scans shell out to the git binary. Pinned explicitly
        // so a scan never picks up the user's own git — and with it their
        // ~/.gitconfig, credential helpers and SSH agent (see git-env.ts).
        ...gitEnv(),
        // Persist scan logs on the local filesystem (desktop has no S3).
        // The storage service enforces per-run and total-size caps itself.
        RUNNER_LOG_DIR: getRunnerLogDir(),
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
        // Conservative resource defaults sized to this machine; the CLI
        // inherits them through the API's env (uv run passes env through).
        ...resourceDefaultEnv(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // When this generation started serving, so its death can be judged on how
    // long it lasted rather than only on how many deaths preceded it.
    const startedAt = Date.now();

    // Last sign of life from the child. A cold boot that is slowly working
    // through `prisma migrate deploy` on a loaded database keeps printing; a
    // genuinely wedged process goes quiet. waitForReady uses this to tell the
    // two apart instead of killing whatever is running when the clock expires.
    let lastOutputAt = Date.now();

    child.stdout?.on("data", (data: Buffer) => {
      lastOutputAt = Date.now();
      process.stderr.write(`[API:${processId}] ${data.toString().trim()}\n`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      lastOutputAt = Date.now();
      process.stderr.write(`[API:${processId}] ${data.toString().trim()}\n`);
    });

    child.on("exit", (code, signal) => {
      process.stderr.write(
        `[API:${processId}] exited with code ${code}${signal ? ` (signal ${signal})` : ""}\n`,
      );
      // stopApi removes the entry from the map before killing; if this child
      // is still the registered one, nobody asked it to die — respawn it.
      const current = this.processes.get(processId);
      if (!current || current.child !== child) return;
      this.processes.delete(processId);
      this.scheduleRestart(processId, port, databaseUrl, startedAt);
    });

    // Without an 'error' listener a failed spawn (ENOENT/EACCES from a
    // corrupted install, AV quarantine, missing entry file) throws an uncaught
    // exception in the main process and crashes the whole app. Surface it as a
    // failed API startup instead, without waiting out the ready timeout.
    const spawnFailed = new Promise<never>((_, reject) => {
      child.on("error", (err) => {
        process.stderr.write(
          `[API:${processId}] process error: ${err.message}\n`,
        );
        reject(new Error(`Failed to launch the API process: ${err.message}`));
      });
    });
    spawnFailed.catch(() => {}); // late errors are logged above, not rethrown

    this.processes.set(processId, { child, port });

    this.progress("Waiting for the service to accept connections…", "service");
    try {
      await Promise.race([
        this.waitForReady(port, () => lastOutputAt),
        spawnFailed,
      ]);
    } catch (err) {
      // If our child died on its own, its exit handler already scheduled the
      // retry — and may already have a replacement running. Killing "the"
      // process here would take that replacement down with it.
      if (this.processes.get(processId)?.child === child) {
        // stopApi drops the map entry before killing, so the exit handler
        // deliberately stays silent — which used to end the story: a restart
        // that failed its readiness probe left nothing scheduled and nothing
        // watching, and the app sat on connection-refused until someone
        // noticed. Re-arm explicitly and let the retry budget decide when to
        // stop.
        await this.stopApi(processId);
        if (isRestart) {
          this.scheduleRestart(processId, port, databaseUrl, startedAt);
          return;
        }
      } else if (isRestart) {
        return;
      }
      // A failed *first* start is fatal: the caller shows it and quits.
      throw err;
    }
  }

  private waitForReady(
    port: number,
    // Timestamp of the child's last stdout/stderr write. While the child is
    // still talking it is making progress (migrations against a busy database
    // can take minutes), so the deadline is extended rather than enforced —
    // otherwise the probe SIGTERMs a healthy boot mid-migration, which is
    // exactly how a recoverable crash turned into a multi-hour outage.
    lastOutputAt: () => number = () => Date.now(),
    // The first API boot does heavy one-time work before binding its port —
    // pg-boss creates its schema, Nest wires every module, and
    // on macOS the embedded Postgres runs under Rosetta. 60s was too tight for
    // that cold start (users hit "not ready after 60000ms" on first launch);
    // warm opens are ~2s, so a generous ceiling only affects the cold case and
    // resolves the instant the API is up.
    timeoutMs = 180_000,
    intervalMs = 500,
    // Hard ceiling regardless of chatter, so a process stuck in a log loop
    // cannot keep the probe alive forever.
    maxTimeoutMs = 900_000,
    // How long the child must be silent before the expired deadline is final.
    quietMs = 45_000,
  ): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      // A silent 3-minute wait reads as a hang; report the elapsed time so the
      // startup window can show that something is still happening.
      const heartbeat = setInterval(() => {
        const seconds = Math.round((Date.now() - start) / 1000);
        this.progress(
          `Starting the service — first launch runs database migrations (${seconds}s)`,
          "service",
        );
      }, 10_000);
      heartbeat.unref?.();
      const done = (): void => {
        clearInterval(heartbeat);
        resolve();
      };
      const fail = (error: Error): void => {
        clearInterval(heartbeat);
        reject(error);
      };

      const check = () => {
        const elapsed = Date.now() - start;
        const quietFor = Date.now() - lastOutputAt();
        if (
          elapsed > timeoutMs &&
          (quietFor >= quietMs || elapsed > maxTimeoutMs)
        ) {
          const logFile = getLogFilePath();
          fail(
            new Error(
              `API on port ${port} not ready after ${elapsed}ms ` +
                `(silent for ${Math.round(quietFor / 1000)}s)` +
                (logFile ? ` — see log for details: ${logFile}` : ""),
            ),
          );
          return;
        }

        const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
          if (res.statusCode === 200) {
            done();
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
    processId: string,
    port: number,
    databaseUrl: string,
    startedAt: number,
  ): void {
    const now = Date.now();
    const uptimeMs = now - startedAt;
    const decision = restartDecision({
      now,
      crashes: this.restartTimestamps.get(processId) ?? [],
      uptimeMs,
    });
    this.restartTimestamps.set(processId, decision.crashes);

    if (!decision.restart) {
      const reason = `The Classifyre service stopped ${decision.attempt} times in ${RESTART_WINDOW_MS / 60000} minutes and is no longer being restarted automatically.`;
      process.stderr.write(
        `[API:${processId}] crashed ${decision.attempt} times in ${RESTART_WINDOW_MS / 60000} minutes; not restarting again\n`,
      );
      // Giving up silently is what made this look like a frozen app: the
      // renderer just retried forever against a port nobody was listening on.
      this.onUnavailable(processId, reason);
      return;
    }
    if (decision.attempt === 1 && uptimeMs >= HEALTHY_RUN_MS) {
      process.stderr.write(
        `[API:${processId}] served ${Math.round(uptimeMs / 60000)} minutes before dying; restart budget reset\n`,
      );
    }
    process.stderr.write(
      `[API:${processId}] restarting in ${RESTART_DELAY_MS}ms (attempt ${decision.attempt}/${MAX_RESTARTS_PER_WINDOW})\n`,
    );
    setTimeout(() => {
      if (this.processes.has(processId)) return;
      this.startApi(processId, port, databaseUrl, true).catch((err) => {
        process.stderr.write(
          `[API:${processId}] restart failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }, RESTART_DELAY_MS);
  }

  /** Lets the UI offer a manual retry after the automatic budget is spent. */
  async restartApiNow(
    processId: string,
    port: number,
    databaseUrl: string,
  ): Promise<void> {
    this.restartTimestamps.delete(processId);
    await this.stopApi(processId);
    await this.startApi(processId, port, databaseUrl);
  }

  async stopApi(processId: string): Promise<void> {
    const managed = this.processes.get(processId);
    if (!managed) return;

    this.processes.delete(processId);

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
}
