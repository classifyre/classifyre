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
}

/** Mutable fields of a namespace. */
export interface UpdateNamespaceInput {
  name?: string;
  description?: string;
  remoteUrl?: string;
  thumbnail?: string;
  settings?: Record<string, unknown>;
  lastOpenedAt?: string;
}

/** Lightweight context emitted on namespace lifecycle events. */
export interface NamespaceLifecycleEvent {
  namespaceId: string;
  slug: string;
  schemaName: string;
}
