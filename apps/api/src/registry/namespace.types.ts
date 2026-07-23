/** A namespace (tenant) as stored in `public.namespaces` and returned by the API. */
export interface Namespace {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  description: string | null;
  type: 'local' | 'remote';
  remoteUrl: string | null;
  thumbnail: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

/** Input to create a namespace. `slug` is derived from `name` when omitted. */
export interface CreateNamespaceInput {
  name: string;
  slug?: string;
  description?: string;
  type?: 'local' | 'remote';
  remoteUrl?: string;
  /** Optional base64 image data URI (`data:image/...;base64,...`), max 2 MB. */
  thumbnail?: string;
}

/** Mutable fields of a namespace. */
export interface UpdateNamespaceInput {
  name?: string;
  /** URL routing alias; editable and validated against SLUG_RE. */
  slug?: string;
  description?: string;
  remoteUrl?: string;
  /**
   * Base64 image data URI to set as the thumbnail (max 2 MB), or `null`/empty
   * to clear it. Omit to leave the existing thumbnail unchanged.
   */
  thumbnail?: string | null;
  settings?: Record<string, unknown>;
  lastOpenedAt?: string;
}

/** Per-namespace source rollups for the workspace directory. */
export interface NamespaceStats {
  id: string;
  totalSources: number;
  failingSources: number;
}

/** Lightweight context emitted on namespace lifecycle events. */
export interface NamespaceLifecycleEvent {
  namespaceId: string;
  slug: string;
  schemaName: string;
}
