import type { UploadedFileMetadata } from "@/components/uploaded-files";
import { getActiveNamespaceSlug } from "@workspace/api-client";

const apiBase = () => {
  let base: string;
  if (typeof window !== "undefined") {
    const desktop = (
      window as Window & {
        __CLASSIFYRE_DESKTOP__?: { apiBaseUrl?: string };
      }
    ).__CLASSIFYRE_DESKTOP__;
    base = desktop?.apiBaseUrl
      ? desktop.apiBaseUrl.replace(/\/$/, "")
      : (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
  } else {
    base = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
  }
  // These raw fetches hit namespace-scoped endpoints, so append the active slug.
  const slug = getActiveNamespaceSlug();
  return slug ? `${base}/${slug}` : base;
};

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
