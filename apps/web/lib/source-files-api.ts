import type { UploadedFileMetadata } from "@/components/uploaded-files";
import { getNamespacedApiBaseUrl } from "@workspace/api-client";

// These raw fetches bypass the generated client (and its namespace middleware),
// so they resolve the same `<base>/<slug>` prefix themselves.
const apiBase = () => getNamespacedApiBaseUrl();

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.text();
  throw new Error(body || `Request failed with HTTP ${response.status}`);
}

export async function listSourceFiles(
  sourceId: string,
): Promise<UploadedFileMetadata[]> {
  const response = await requireOk(
    await fetch(`${apiBase()}/sources/${sourceId}/files`),
  );
  return response.json() as Promise<UploadedFileMetadata[]>;
}

export async function uploadSourceFile(
  sourceId: string,
  file: File,
): Promise<UploadedFileMetadata> {
  const form = new FormData();
  form.append("file", file);
  const response = await requireOk(
    await fetch(`${apiBase()}/sources/${sourceId}/files`, {
      method: "POST",
      body: form,
    }),
  );
  return response.json() as Promise<UploadedFileMetadata>;
}

/**
 * Upload one file, reporting progress as it goes.
 *
 * XHR rather than fetch: `fetch` has no upload-progress event, and a 50 MB dump
 * uploading behind a spinner that never moves is indistinguishable from one
 * that has hung. The response is the stored file's metadata, same as the
 * fetch-based call above.
 */
export function uploadSourceFileWithProgress(
  sourceId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadedFileMetadata>; abort: () => void } {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadedFileMetadata>((resolve, reject) => {
    request.open("POST", `${apiBase()}/sources/${sourceId}/files`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        try {
          resolve(JSON.parse(request.responseText) as UploadedFileMetadata);
        } catch {
          reject(new Error("The server returned an unreadable response"));
        }
        return;
      }
      // The API answers a duplicate with 409 and a JSON body naming the file
      // that already holds those bytes; surface that rather than the status.
      let message = `Upload failed with HTTP ${request.status}`;
      try {
        const body = JSON.parse(request.responseText) as { message?: unknown };
        if (typeof body.message === "string") message = body.message;
      } catch {
        if (request.responseText) message = request.responseText;
      }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("The upload could not be sent"));
    request.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });

  return { promise, abort: () => request.abort() };
}

export async function deleteSourceFile(
  sourceId: string,
  fileId: string,
): Promise<void> {
  await requireOk(
    await fetch(`${apiBase()}/sources/${sourceId}/files/${fileId}`, {
      method: "DELETE",
    }),
  );
}
