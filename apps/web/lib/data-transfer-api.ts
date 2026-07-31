import { getApiBaseUrl, getNamespacedApiBaseUrl } from "@workspace/api-client";

/**
 * Raw fetches against the namespace-scoped data-transfer endpoints.
 *
 * Hand-written rather than generated because the download is a browser
 * navigation and the upload is multipart — neither goes through the generated
 * client — and keeping the whole surface in one place beats splitting it across
 * two clients.
 */

const apiBase = () => getNamespacedApiBaseUrl();

/**
 * Same endpoints against an explicit namespace, for the workspace-creation flow
 * where the new namespace is not (yet) the one the app is rendering — the
 * landing page has no active slug at all, so the un-namespaced base is the only
 * correct starting point. The API resolves a namespace's immutable id exactly
 * as it resolves its slug.
 */
export function apiBaseForNamespace(namespaceId: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, "")}/${namespaceId}`;
}

export type TransferScopeId =
  | "sources"
  | "sourceFiles"
  | "assets"
  | "findings"
  | "customDetectors"
  | "glossary"
  | "fingerprints"
  | "investigations"
  | "scanData"
  | "harness"
  | "instanceConfig";

export type TransferKind = "EXPORT" | "IMPORT";

export type TransferStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ConflictMode = "SKIP" | "OVERWRITE";

export interface TransferScope {
  id: TransferScopeId;
  label: string;
  description: string;
  dependsOn: TransferScopeId[];
  heavy: boolean;
  redactsSecrets: boolean;
  rows: number;
}

export interface TransferJob {
  id: string;
  kind: TransferKind;
  status: TransferStatus;
  scopes: TransferScopeId[];
  conflictMode: ConflictMode;
  fileName: string | null;
  fileSize: number | null;
  checksum: string | null;
  downloadAvailable: boolean;
  totalRows: number;
  processedRows: number;
  skippedRows: number;
  percent: number;
  currentTable: string | null;
  counts: Record<string, number>;
  warnings: string[];
  errorMessage: string | null;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ArchivePreview {
  uploadId: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  appVersion: string;
  sourceNamespace: string;
  scopes: TransferScopeId[];
  rowsByScope: Record<string, number>;
  totalRows: number;
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.text();
  // Nest error bodies are `{"message": "...", "statusCode": 400}`; surface the
  // message rather than the JSON.
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    const message = Array.isArray(parsed.message)
      ? parsed.message.join(", ")
      : parsed.message;
    if (message) throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
  }
  throw new Error(body || `Request failed with HTTP ${response.status}`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await requireOk(await fetch(url));
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await requireOk(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return response.json() as Promise<T>;
}

export function listTransferScopes(base = apiBase()): Promise<TransferScope[]> {
  return getJson<TransferScope[]>(`${base}/data-transfer/scopes`);
}

export async function listTransferJobs(base = apiBase()): Promise<TransferJob[]> {
  const { jobs } = await getJson<{ jobs: TransferJob[] }>(
    `${base}/data-transfer/jobs`,
  );
  return jobs;
}

export function getTransferJob(
  id: string,
  base = apiBase(),
): Promise<TransferJob> {
  return getJson<TransferJob>(`${base}/data-transfer/jobs/${id}`);
}

export function startExport(
  scopes: TransferScopeId[],
  base = apiBase(),
): Promise<TransferJob> {
  return postJson<TransferJob>(`${base}/data-transfer/exports`, { scopes });
}

export async function uploadArchive(
  file: File,
  base = apiBase(),
): Promise<ArchivePreview> {
  const form = new FormData();
  form.append("file", file);
  const response = await requireOk(
    await fetch(`${base}/data-transfer/imports/upload`, {
      method: "POST",
      body: form,
    }),
  );
  return response.json() as Promise<ArchivePreview>;
}

export function startImport(
  input: {
    uploadId: string;
    scopes: TransferScopeId[];
    conflictMode?: ConflictMode;
  },
  base = apiBase(),
): Promise<TransferJob> {
  return postJson<TransferJob>(`${base}/data-transfer/imports`, input);
}

export function cancelTransferJob(
  id: string,
  base = apiBase(),
): Promise<TransferJob> {
  return postJson<TransferJob>(
    `${base}/data-transfer/jobs/${id}/cancel`,
    {},
  );
}

export async function deleteTransferJob(
  id: string,
  base = apiBase(),
): Promise<void> {
  await requireOk(
    await fetch(`${base}/data-transfer/jobs/${id}`, { method: "DELETE" }),
  );
}

export function downloadUrl(id: string, base = apiBase()): string {
  return `${base}/data-transfer/exports/${id}/download`;
}

/** `1.4 GB`, `812 KB`, `—` for an unknown size. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatRows(rows: number): string {
  return rows.toLocaleString();
}

export function isTerminal(status: TransferStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}
