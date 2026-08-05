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
  /** Uploaded and inspected, but nothing queued: the operator is still choosing. */
  | "STAGED"
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

/** Where an upload has got to, as reported by {@link uploadArchive}. */
export interface UploadProgress {
  /** Bytes accepted by the server so far. */
  loaded: number;
  total: number;
  /** 0–100, or null while the total is still unknown. */
  percent: number | null;
  /**
   * True once every byte has been sent and the server is reading the archive's
   * manifest. Short, but on a 250 MB file it is the difference between "stuck
   * at 100%" and a state the UI can name.
   */
  finalising: boolean;
}

/**
 * Send an archive and report progress while it goes.
 *
 * XMLHttpRequest rather than `fetch` purely for `upload.onprogress`: fetch
 * still cannot report request-body progress in any shipping browser, and a
 * quarter-gigabyte upload behind an indeterminate spinner is indistinguishable
 * from one that has hung — which is exactly how this read before.
 */
export function uploadArchive(
  file: File,
  base = apiBase(),
  onProgress?: (progress: UploadProgress) => void,
): Promise<ArchivePreview> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", `${base}/data-transfer/imports/upload`);
    request.responseType = "text";

    request.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      onProgress?.({
        loaded: event.loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
        finalising: false,
      });
    };
    request.upload.onload = () => {
      onProgress?.({
        loaded: file.size,
        total: file.size,
        percent: 100,
        finalising: true,
      });
    };

    request.onload = () => {
      const body = request.responseText;
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(body) as ArchivePreview);
        } catch {
          reject(new Error("The server returned an unreadable response"));
        }
        return;
      }
      reject(new Error(errorMessageFrom(body, request.status)));
    };
    request.onerror = () =>
      reject(new Error("The connection dropped while uploading the archive"));
    request.ontimeout = () =>
      reject(new Error("The upload timed out"));
    request.onabort = () => reject(new Error("The upload was cancelled"));

    request.send(form);
  });
}

/** Nest error bodies are `{"message": …}`; fall back to the raw text. */
function errorMessageFrom(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    const message = Array.isArray(parsed.message)
      ? parsed.message.join(", ")
      : parsed.message;
    if (message) return message;
  } catch {
    // Not JSON — use whatever came back.
  }
  return body || `Upload failed with HTTP ${status}`;
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

/**
 * Fetch an export archive and save it under its own name.
 *
 * Deliberately not a plain `<a href download>`. An anchor cannot tell whether
 * the request succeeded: when the API answers 404 (the archive expired, or the
 * pod serving the download cannot see the file the worker wrote), the browser
 * happily saves the JSON error body, names it after the URL's last segment, and
 * the operator gets a file called `download.json` with no indication anything
 * went wrong. Reading the response first means a failure surfaces as the error
 * message the API actually sent, and the saved file always carries the name the
 * job recorded rather than whatever the browser infers.
 */
export async function downloadArchive(
  job: Pick<TransferJob, "id" | "fileName">,
  base = apiBase(),
): Promise<void> {
  const response = await fetch(downloadUrl(job.id, base));
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // Not a JSON error body — fall through to the raw text.
    }
    throw new Error(message || `Download failed with HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = job.fileName ?? "workspace-archive.cfyre";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a tick to start reading before the blob is released.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
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

/** A transfer the server is actually working on, as opposed to one staged or done. */
export function isRunning(status: TransferStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}
