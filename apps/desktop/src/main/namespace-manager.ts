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
  /** Advanced: cap on concurrent scans (passed to the API as MAX_PARALLEL_SCANS). */
  maxParallelScans?: number;
  /** Advanced: Node heap limit for the API process, in MB. */
  memoryLimitMb?: number;
}

export type NamespaceUpdate = Partial<
  Pick<Namespace, 'name' | 'remoteUrl' | 'apiPort' | 'maxParallelScans' | 'memoryLimitMb'>
>;

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

  create(name: string, remoteUrl?: string): Namespace {
    const id = randomUUID();
    const isRemote = !!remoteUrl;
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
      ...(isRemote ? { remoteUrl } : {}),
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
      const parsed = new URL(patch.remoteUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      ns.remoteUrl = patch.remoteUrl;
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
