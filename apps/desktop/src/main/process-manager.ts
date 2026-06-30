import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import os from 'os';
import treeKill from 'tree-kill';

function getShellPath(): string {
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
  const extras = [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  const nvmDir = path.join(home, '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).filter((v) => v.startsWith('v')).sort().reverse();
      if (versions[0]) {
        extras.unshift(path.join(nvmDir, versions[0], 'bin'));
      }
    } catch { /* ignore */ }
  }

  return extras.join(':');
}

let cachedEnv: Record<string, string> | null = null;

function getShellEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv;
  cachedEnv = { ...process.env, PATH: getShellPath() } as Record<string, string>;
  return cachedEnv;
}

function findBun(): string {
  const candidates = [
    path.join(os.homedir(), '.bun/bin/bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'bun';
}

interface ManagedProcess {
  child: ChildProcess;
  port: number;
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();

  private getApiEntryPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'api', 'dist', 'src', 'main.js');
    }
    return path.join(__dirname, '../../../api/dist/src/main.js');
  }

  private getCliPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'cli');
    }
    return path.join(__dirname, '../../../cli');
  }

  private getVenvPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'venv');
    }
    return path.join(__dirname, '../../../cli/.venv');
  }

  // Bundled Amazon Corretto JRE used by the Spark-backed lakehouse sources
  // (pyspark). Staged into resources/jre by build-desktop.sh; normalized so
  // that <jre>/bin/java exists on every platform.
  private getJreHome(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'jre');
    }
    return path.join(__dirname, '../../../cli/.jre-desktop');
  }

  private getPrismaDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'prisma');
    }
    return path.join(__dirname, '../../../api/prisma');
  }

  async startApi(
    namespaceId: string,
    port: number,
    databaseUrl: string,
  ): Promise<void> {
    if (this.processes.has(namespaceId)) {
      return;
    }

    const entryPath = this.getApiEntryPath();
    const cliPath = this.getCliPath();
    const venvPath = this.getVenvPath();

    // Expose the bundled JRE to the CLI subprocess the API spawns (it inherits
    // this env via `{ ...process.env }`), so pyspark's lakehouse sources find Java.
    const baseEnv = getShellEnv();
    const jreHome = this.getJreHome();
    const jreBin = path.join(jreHome, 'bin');
    const javaEnv = fs.existsSync(jreBin)
      ? {
          JAVA_HOME: jreHome,
          PATH: `${jreBin}${path.delimiter}${baseEnv.PATH ?? ''}`,
        }
      : {};

    const child = spawn('node', [entryPath], {
      env: {
        ...baseEnv,
        ...javaEnv,
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        ENVIRONMENT: 'desktop',
        CLI_PATH: cliPath,
        VENV_PATH: venvPath,
        CORS_ORIGIN: '*',
        CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS: '0',
        NODE_ENV: 'development',
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

    await this.waitForReady(port);
  }

  private getApiDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'api');
    }
    return path.join(__dirname, '../../../api');
  }

  async runMigrations(databaseUrl: string): Promise<void> {
    const prismaSchemaPath = path.join(this.getPrismaDir(), 'schema.prisma');
    const apiDir = this.getApiDir();

    console.log(`[migrations] Running in ${apiDir} with schema ${prismaSchemaPath}`);

    return new Promise((resolve, reject) => {
      const bun = findBun();
      const child = spawn(
        bun,
        ['x', 'prisma', 'migrate', 'deploy', '--schema', prismaSchemaPath],
        {
          cwd: apiDir,
          env: {
            ...getShellEnv(),
            DATABASE_URL: databaseUrl,
          },
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
    timeoutMs = 30_000,
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
