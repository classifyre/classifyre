import { net } from 'electron';

/** Namespace fields needed by native desktop menus. The API owns all data. */
export interface ApiNamespace {
  id: string;
  name: string;
  slug: string;
  type: 'local' | 'remote';
  remoteUrl: string | null;
}

type Listener = () => void;

/**
 * Read-only mirror of the API namespace registry for native Electron chrome.
 *
 * The web app performs namespace CRUD directly against the API. Native menus
 * cannot fetch asynchronously while they are opening, so this store keeps a
 * small, periodically refreshed snapshot and notifies the menu builders when
 * it changes.
 */
export class NamespaceStore {
  private namespaces: ApiNamespace[] = [];
  private listeners = new Set<Listener>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly apiBaseUrl: string) {}

  list(): ApiNamespace[] {
    return this.namespaces.map((namespace) => ({ ...namespace }));
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(intervalMs = 10_000): Promise<void> {
    await this.refresh();
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => void this.refresh(), intervalMs);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchNamespaces().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchNamespaces(): Promise<void> {
    try {
      const response = await net.fetch(`${this.apiBaseUrl}/namespaces`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('unexpected response');
      }

      const next = payload.map(parseNamespace);
      if (JSON.stringify(next) === JSON.stringify(this.namespaces)) return;
      this.namespaces = next;
      for (const listener of this.listeners) listener();
    } catch (error) {
      // Keep the last good snapshot during a transient API restart.
      console.warn(
        `[namespaces] Failed to refresh native menus: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function parseNamespace(value: unknown): ApiNamespace {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid namespace entry');
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row['id'] !== 'string' ||
    typeof row['name'] !== 'string' ||
    typeof row['slug'] !== 'string' ||
    (row['type'] !== 'local' && row['type'] !== 'remote') ||
    (row['remoteUrl'] !== null && typeof row['remoteUrl'] !== 'string')
  ) {
    throw new Error('invalid namespace entry');
  }
  return {
    id: row['id'],
    name: row['name'],
    slug: row['slug'],
    type: row['type'],
    remoteUrl: row['remoteUrl'],
  };
}
