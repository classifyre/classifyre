/** One external link shown on a workspace card. Both fields are mandatory. */
export interface NamespaceExternalLink {
  /** Stable id so the settings editor can key rows across reorders. */
  id: string;
  /** Human label; doubles as the link's `title`/`aria-label` in the UI. */
  title: string;
  /** Absolute HTTP(S) URL, opened in a new tab. */
  url: string;
}

/** Input shape for a link: the id is assigned server-side when omitted. */
export interface NamespaceExternalLinkInput {
  id?: string;
  title: string;
  url: string;
}

/** A workspace category. Flat, shared across workspaces, stored in `public`. */
export interface NamespaceCategory {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** Number of active workspaces filed under it. */
  workspaceCount: number;
  /** True for the built-in default category, which cannot be deleted. */
  isDefault: boolean;
}

export interface CreateNamespaceCategoryInput {
  title: string;
  description?: string | null;
}

export interface UpdateNamespaceCategoryInput {
  title?: string;
  description?: string | null;
}

/** A namespace (tenant) as stored in `public.namespaces` and returned by the API. */
export interface Namespace {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  description: string | null;
  thumbnail: string | null;
  settings: Record<string, unknown>;
  /** Ordered external links shown on the workspace card. */
  externalLinks: NamespaceExternalLink[];
  /** Categories this workspace is filed under; never empty. */
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

/** Input to create a namespace. `slug` is derived from `name` when omitted. */
export interface CreateNamespaceInput {
  name: string;
  slug?: string;
  description?: string;
  /** Optional base64 image data URI (`data:image/...;base64,...`), max 2 MB. */
  thumbnail?: string;
  externalLinks?: NamespaceExternalLinkInput[];
  /** Categories to file it under. Defaults to the built-in default category. */
  categoryIds?: string[];
}

/** Mutable fields of a namespace. */
export interface UpdateNamespaceInput {
  name?: string;
  /** URL routing alias; editable and validated against SLUG_RE. */
  slug?: string;
  description?: string;
  /**
   * Base64 image data URI to set as the thumbnail (max 2 MB), or `null`/empty
   * to clear it. Omit to leave the existing thumbnail unchanged.
   */
  thumbnail?: string | null;
  settings?: Record<string, unknown>;
  lastOpenedAt?: string;
  /** Replaces the whole link array. Omit to leave links untouched. */
  externalLinks?: NamespaceExternalLinkInput[];
  /**
   * Replaces the whole category set. An empty array is not an error -- it files
   * the workspace under the default category, because a workspace is never
   * uncategorised.
   */
  categoryIds?: string[];
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
