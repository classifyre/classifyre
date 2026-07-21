import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

export interface Namespace {
  id: string;
  name: string;
  type: 'local' | 'remote';
  schemaName: string;
  remoteUrl?: string;
  createdAt: string;
  lastOpenedAt: string;
  /** Fixed API port; undefined = allocate dynamically on open. */
  apiPort?: number;
  /** Advanced: cap on concurrent scans (passed to the API as MAX_CONCURRENT_RUNNERS). */
  maxParallelScans?: number;
  /** Advanced: Node heap limit for the API process, in MB. */
  memoryLimitMb?: number;
  /** Custom environment variables injected into this workspace's API process. */
  env?: Record<string, string>;
}

export type NamespaceUpdate = Partial<
  Pick<Namespace, 'name' | 'remoteUrl' | 'apiPort' | 'maxParallelScans' | 'memoryLimitMb' | 'env'>
>;

// Env vars the desktop app itself manages (ports, paths, secrets, process
// wiring). Letting a workspace override these would break or hijack the
// runtime, so they are rejected at save time — everything else (EMBEDDING_*,
// runner limits, feature flags…) is fair game and wins over the defaults.
export const RESERVED_ENV_KEYS = new Set([
  'PORT',
  'DATABASE_URL',
  'PATH',
  'NODE_ENV',
  'ENVIRONMENT',
  'ELECTRON_RUN_AS_NODE',
  'CLASSIFYRE_AUTO_MIGRATE',
  'CLASSIFYRE_MASKED_CONFIG_KEY',
  'CLI_PATH',
  'VENV_PATH',
  'UV_PROJECT_ENVIRONMENT',
  'UV_CACHE_DIR',
  'RUNNER_LOG_DIR',
  'CORS_ORIGIN',
]);

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ENV_MAX_VARS = 50;
const ENV_MAX_VALUE_LENGTH = 4096;

// New local workspaces get a fixed API port so their MCP URL stays stable
// across restarts (a dynamically allocated port changes on every open, which
// breaks any MCP client pinned to it). The range sits above the usual dev-tool
// ports (3000/5432/8000/8080…) and below the IANA ephemeral range (49152+), so
// collisions with other software are unlikely. If the chosen port is busy at
// open time the runtime surfaces a clear error rather than silently moving it.
const API_PORT_RANGE_START = 8790;
const API_PORT_RANGE_END = 8990;

export function validateCustomEnv(env: Record<string, string>): void {
  const entries = Object.entries(env);
  if (entries.length > ENV_MAX_VARS) {
    throw new Error(`Too many environment variables (max ${ENV_MAX_VARS})`);
  }
  for (const [key, value] of entries) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name: "${key}"`);
    }
    if (RESERVED_ENV_KEYS.has(key.toUpperCase())) {
      throw new Error(`"${key}" is managed by the app and cannot be overridden`);
    }
    if (typeof value !== 'string' || value.length > ENV_MAX_VALUE_LENGTH) {
      throw new Error(`Value for "${key}" must be a string of at most ${ENV_MAX_VALUE_LENGTH} characters`);
    }
  }
}

// A remote workspace is a full Classifyre server the app renders in a trusted
// tab, so plaintext HTTP would let a network attacker rewrite the page and
// harvest the session. Require https:, except for loopback hosts (local
// development against a server on this machine).
export function assertValidRemoteUrl(url: string): void {
  const parsed = new URL(url); // throws on malformed input
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  const isLoopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '::1' ||
    host === '[::1]';
  if (!isLoopback) {
    throw new Error('Remote workspaces must use https:// (http:// is only allowed for localhost)');
  }
}

export class NamespaceManager {
  private filePath: string;
  private namespaces: Namespace[] = [];

  constructor() {
    const base = process.env['CLASSIFYRE_DATA_DIR'] || app.getPath('userData');
    this.filePath = path.join(base, 'namespaces.json');
    this.load();
  }

  private load(): void {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as Namespace[];
      this.namespaces = parsed.map((ns) => ({
        ...ns,
        type: ns.type || 'local',
      }));
    } catch {
      this.namespaces = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.namespaces, null, 2));
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  list(): Namespace[] {
    return [...this.namespaces];
  }

  /**
   * Smallest port in the reserved range not already claimed by another
   * workspace, so a fresh workspace gets a stable, non-colliding API port.
   * Returns undefined if the range is exhausted (fall back to dynamic
   * allocation at open time). Whether the port is actually free on the host is
   * only known at open — the runtime checks it then and errors if it's busy.
   */
  private allocateStablePort(): number | undefined {
    const taken = new Set(
      this.namespaces.map((n) => n.apiPort).filter((p): p is number => typeof p === 'number'),
    );
    for (let port = API_PORT_RANGE_START; port <= API_PORT_RANGE_END; port++) {
      if (!taken.has(port)) return port;
    }
    return undefined;
  }

  create(name: string, remoteUrl?: string): Namespace {
    const id = randomUUID();
    const isRemote = !!remoteUrl;
    if (remoteUrl) assertValidRemoteUrl(remoteUrl);
    const slug = this.slugify(name) || id.slice(0, 8);

    const existing = this.namespaces.map((n) => n.schemaName);
    let schemaName = `ns_${slug}`;
    let counter = 1;
    while (existing.includes(schemaName)) {
      schemaName = `ns_${slug}_${counter++}`;
    }

    const ns: Namespace = {
      id,
      name,
      type: isRemote ? 'remote' : 'local',
      schemaName,
      ...(isRemote ? { remoteUrl } : { apiPort: this.allocateStablePort() }),
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };

    this.namespaces.push(ns);
    this.save();
    return ns;
  }

  delete(id: string): void {
    this.namespaces = this.namespaces.filter((n) => n.id !== id);
    this.save();
  }

  update(id: string, patch: NamespaceUpdate): Namespace {
    const ns = this.namespaces.find((n) => n.id === id);
    if (!ns) throw new Error(`Namespace ${id} not found`);

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('Name cannot be empty');
      ns.name = name;
    }
    if (patch.remoteUrl !== undefined && ns.type === 'remote') {
      assertValidRemoteUrl(patch.remoteUrl);
      ns.remoteUrl = patch.remoteUrl;
    }
    if ('env' in patch) {
      const env = patch.env;
      if (env === undefined || env === null || Object.keys(env).length === 0) {
        delete ns.env;
      } else {
        validateCustomEnv(env);
        ns.env = { ...env };
      }
    }
    for (const key of ['apiPort', 'maxParallelScans', 'memoryLimitMb'] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value === undefined || value === null || value === 0) {
        delete ns[key];
      } else {
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`Invalid value for ${key}: ${value}`);
        }
        if (key === 'apiPort' && (value < 1024 || value > 65535)) {
          throw new Error('API port must be between 1024 and 65535');
        }
        ns[key] = value;
      }
    }

    this.save();
    return ns;
  }

  get(id: string): Namespace | undefined {
    return this.namespaces.find((n) => n.id === id);
  }

  getDefault(): Namespace | undefined {
    return this.namespaces[0];
  }

  updateLastOpened(id: string): void {
    const ns = this.namespaces.find((n) => n.id === id);
    if (ns) {
      ns.lastOpenedAt = new Date().toISOString();
      this.save();
    }
  }
}
