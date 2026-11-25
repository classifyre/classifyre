import type { CatalogDdl } from './catalog-ddl';

/** Raised when the catalog sidecar socket closes or restarts unexpectedly. */
export class CatalogBackendDisconnectedError extends Error {
  constructor(message = 'The catalog backend disconnected.') {
    super(message);
    this.name = 'CatalogBackendDisconnectedError';
  }
}

/** Raised when `maxCatalogDbs` active catalog databases are already in use. */
export class CatalogCapacityError extends Error {
  constructor(message = 'Catalog database capacity reached.') {
    super(message);
    this.name = 'CatalogCapacityError';
  }
}

/** One dedicated catalog backend connection owned 1:1 by a live client session. */
export interface CatalogSession {
  /** Opaque catalog database name (`c_<hash>`). */
  readonly database: string;
  /** Locked-down login role (`r_<hash>`). */
  readonly role: string;
  /** Raw PostgreSQL v3 protocol messages in, backend reply bytes out. */
  raw(bytes: Buffer): Promise<Buffer>;
  /** Run simple SQL (startup session settings). */
  exec(sql: string): Promise<void>;
  /** Run a read query and return plain row objects (e.g. pg_settings). */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Called if the underlying backend connection drops unexpectedly. */
  onDisconnect(listener: (error: Error) => void): void;
  /** Close the dedicated backend connection and release its catalog reference. */
  close(): Promise<void>;
}

/** Input to open a dedicated catalog session for a signed-in connection. */
export interface OpenCatalogSessionInput {
  workspaceId: string;
  connectionId: string;
  ddl: CatalogDdl;
}
