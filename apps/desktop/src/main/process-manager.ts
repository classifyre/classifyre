import { spawn, spawnSync, execFileSync, type ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import os from 'os';
import crypto from 'crypto';
import treeKill from 'tree-kill';
import { ensurePythonRuntime } from './python-env.js';

// In dev mode we inherit the developer's login-shell PATH so locally installed
// tooling (uv, java, node) is visible. In packaged mode we never touch the
// user's shell: everything the app needs is bundled, and the PATH is built
// from the bundled resources plus standard system directories only.
function getDevShellPath(): string {
  const shells = ['/bin/zsh', '/bin/bash'];
  for (const shell of shells) {
    try {
      if (!fs.existsSync(shell)) continue;
      const raw = execFileSync(shell, ['-lc', 'echo $PATH'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (raw) return raw;
    } catch { /* fall through */ }
  }

  const home = os.homedir();
  return [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');
}

function getSystemPath(): string {
  if (process.platform === 'win32') {
    return process.env['PATH'] ?? '';
  }
  return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
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
    delete cachedEnv['ELECTRON_RUN_AS_NODE'];
  } else {
    cachedEnv = { ...process.env, PATH: getDevShellPath() } as Record<string, string>;
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
  const keyFile = path.join(app.getPath('userData'), 'masked-config.key');
  try {
    const existing = fs.readFileSync(keyFile, 'utf-8').trim();
    if (existing) {
      cachedMaskedConfigKey = existing;
      return existing;
    }
  } catch {
    // first run — generate below
  }
  const key = `base64:${crypto.randomBytes(32).toString('base64')}`;
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  cachedMaskedConfigKey = key;
  return key;
}

export interface ApiRuntimeOptions {
  maxParallelScans?: number;
  memoryLimitMb?: number;
}

interface ManagedProcess {
  child: ChildProcess;
  port: number;
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private venvPathOverride: string | null = null;
  private venvPrepared = false;
  private apiDirCache: string | null = null;

  // Rewires the bundled Python venv for this machine. Lazy: runs on the first
  // workspace open (covered by the loading indicator) rather than at app
  // startup — the first-launch copy can move gigabytes.
  private prepareVenv(): void {
    if (this.venvPrepared) return;
    this.venvPrepared = true;
    try {
      const venvPath = ensurePythonRuntime();
      if (venvPath) this.venvPathOverride = venvPath;
    } catch (err) {
      console.error('Failed to prepare Python runtime:', err);
    }
  }

  // On macOS the API tree ships as ONE api.tar.gz (its ~65k node_modules
  // files made Apple's notary scan take hours) and is unpacked to userData on
  // first workspace open, once per app version. Other platforms bundle the
  // plain resources/api directory.
  private ensureApiDir(): string {
    if (this.apiDirCache) return this.apiDirCache;

    const bundledDir = path.join(process.resourcesPath, 'api');
    const archive = path.join(process.resourcesPath, 'api.tar.gz');
    if (fs.existsSync(bundledDir) || !fs.existsSync(archive)) {
      this.apiDirCache = bundledDir;
      return bundledDir;
    }

    const root = path.join(app.getPath('userData'), 'api-runtime');
    const markerFile = path.join(root, 'version.json');
    const extractedDir = path.join(root, 'api');
    try {
      const marker = JSON.parse(fs.readFileSync(markerFile, 'utf-8')) as { version?: string };
      if (marker.version === app.getVersion() && fs.existsSync(extractedDir)) {
        this.apiDirCache = extractedDir;
        return extractedDir;
      }
    } catch {
      // no valid extraction yet
    }

    console.log(`[api-runtime] Extracting bundled API to ${root}…`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    const result = spawnSync('tar', ['-xzf', archive, '-C', root], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`Failed to extract bundled API (tar exited ${result.status})`);
    }
    fs.writeFileSync(markerFile, JSON.stringify({ version: app.getVersion() }));
    console.log('[api-runtime] Extraction complete');
    this.apiDirCache = extractedDir;
    return extractedDir;
  }

  private getApiEntryPath(): string {
    if (app.isPackaged) {
      // Packaged: the whole API is one esbuild bundle at the api-tree root
      // (see apps/desktop/scripts/bundle-api.mjs). Dev still runs the plain
      // tsc output.
      return path.join(this.ensureApiDir(), 'backend.js');
    }
    return path.join(__dirname, '../../../api/dist/src/main.js');
  }

  private getCliPath(): string {
    if (app.isPackaged) {
      // pyapp mirrors the monorepo layout (apps/cli + packages/schemas) so the
      // CLI pyproject's relative editable dep stays valid for runtime uv sync.
      return path.join(process.resourcesPath, 'pyapp', 'apps', 'cli');
    }
    return path.join(__dirname, '../../../cli');
  }

  private getVenvPath(): string {
    if (this.venvPathOverride) return this.venvPathOverride;
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'venv');
    }
    return path.join(__dirname, '../../../cli/.venv');
  }

  private getPrismaDir(): string {
    if (app.isPackaged) {
      // Staged inside the api tree so `prisma generate` at build time and
      // `prisma migrate deploy` at runtime share one schema location.
      return path.join(this.ensureApiDir(), 'prisma');
    }
    return path.join(__dirname, '../../../api/prisma');
  }

  private getApiDir(): string {
    if (app.isPackaged) {
      return this.ensureApiDir();
    }
    return path.join(__dirname, '../../../api');
  }

  // Runs a script with Electron's embedded Node.js so the packaged app never
  // depends on a system-wide node installation.
  private nodeSpawnEnv(extra: Record<string, string>): Record<string, string> {
    return {
      ...getBaseEnv(),
      ...extra,
      ELECTRON_RUN_AS_NODE: '1',
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

    this.prepareVenv();

    const entryPath = this.getApiEntryPath();
    const cliPath = this.getCliPath();
    const venvPath = this.getVenvPath();

    const baseEnv = getBaseEnv();

    const venvBin = path.join(venvPath, process.platform === 'win32' ? 'Scripts' : 'bin');
    const pathWithVenv = fs.existsSync(venvBin)
      ? `${venvBin}${path.delimiter}${baseEnv['PATH'] ?? ''}`
      : baseEnv['PATH'] ?? '';

    const nodeArgs: string[] = [];
    if (options.memoryLimitMb && options.memoryLimitMb > 0) {
      nodeArgs.push(`--max-old-space-size=${Math.floor(options.memoryLimitMb)}`);
    }

    const child = spawn(process.execPath, [...nodeArgs, entryPath], {
      env: {
        ...baseEnv,
        PATH: pathWithVenv,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        ENVIRONMENT: 'desktop',
        CLI_PATH: cliPath,
        VENV_PATH: venvPath,
        // Pin uv's project environment to the (possibly relocated) venv so
        // `uv run` / on-demand `uv sync --group X` target it instead of
        // creating .venv inside the read-only bundled CLI directory. Only the
        // base deps are baked; optional detector/source groups install on
        // first use, so auto-install must stay enabled (it defaults to on).
        UV_PROJECT_ENVIRONMENT: venvPath,
        CLASSIFYRE_MASKED_CONFIG_KEY: getMaskedConfigKey(),
        CORS_ORIGIN: '*',
        NODE_ENV: app.isPackaged ? 'production' : 'development',
        ...(options.maxParallelScans && options.maxParallelScans > 0
          ? { MAX_PARALLEL_SCANS: String(Math.floor(options.maxParallelScans)) }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      process.stderr.write(`[API:${namespaceId}] ${data.toString().trim()}\n`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[API:${namespaceId}] ${data.toString().trim()}\n`);
    });

    child.on('exit', (code) => {
      process.stderr.write(`[API:${namespaceId}] exited with code ${code}\n`);
      this.processes.delete(namespaceId);
    });

    this.processes.set(namespaceId, { child, port });

    try {
      await this.waitForReady(port);
    } catch (err) {
      await this.stopApi(namespaceId);
      throw err;
    }
  }

  // Locates the Prisma CLI bundled with the API's node_modules; runs offline
  // with Electron's Node — no bun, no npx, no network.
  private getPrismaCliPath(): string {
    const candidates = [
      path.join(this.getApiDir(), 'node_modules', 'prisma', 'build', 'index.js'),
      // Dev fallback: hoisted install at the monorepo root.
      path.join(__dirname, '../../../../node_modules/prisma/build/index.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
      `Prisma CLI not found (looked in: ${candidates.join(', ')}). ` +
        'The desktop bundle must include api/node_modules/prisma.',
    );
  }

  async runMigrations(databaseUrl: string): Promise<void> {
    const prismaSchemaPath = path.join(this.getPrismaDir(), 'schema.prisma');
    const apiDir = this.getApiDir();
    const prismaCli = this.getPrismaCliPath();

    console.log(`[migrations] Running in ${apiDir} with schema ${prismaSchemaPath}`);

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [prismaCli, 'migrate', 'deploy', '--schema', prismaSchemaPath],
        {
          cwd: apiDir,
          env: this.nodeSpawnEnv({
            DATABASE_URL: databaseUrl,
            // Prisma CLI must not try to download engines at runtime.
            PRISMA_CLI_TELEMETRY_INFORMATION: 'disabled',
            CHECKPOINT_DISABLE: '1',
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Prisma migrate failed (code ${code}): ${stderr}`));
        }
      });

      child.on('error', reject);
    });
  }

  private waitForReady(
    port: number,
    timeoutMs = 60_000,
    intervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`API on port ${port} not ready after ${timeoutMs}ms`));
          return;
        }

        const req = http.get(
          `http://127.0.0.1:${port}/`,
          (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              setTimeout(check, intervalMs);
            }
            res.resume();
          },
        );

        req.on('error', () => {
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
        treeKill(pid, 'SIGKILL', () => resolve());
      }, 5000);

      child.on('exit', () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      treeKill(pid, 'SIGTERM');
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
