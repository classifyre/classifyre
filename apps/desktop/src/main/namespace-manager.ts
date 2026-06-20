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
