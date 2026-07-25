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
