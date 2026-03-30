import { ResponseError } from "@workspace/api-client";

type ErrorPayload = {
  message?: unknown;
  error?: unknown;
  detail?: unknown;
};

function normalizeErrorField(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const messages = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    if (messages.length > 0) {
      return messages.join(", ");
    }
  }

  return null;
}

export async function extractApiErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error instanceof ResponseError) {
    const response = error.response;
    const contentType = response.headers.get("content-type") || "";

    try {
      if (contentType.includes("json")) {
        const payload = (await response.clone().json()) as ErrorPayload;
        const payloadMessage =
          normalizeErrorField(payload.message) ??
          normalizeErrorField(payload.error) ??
          normalizeErrorField(payload.detail);

        if (payloadMessage) {
          return payloadMessage;
        }
      } else {
        const text = (await response.clone().text()).trim();
        if (text.length > 0) {
          return text;
        }
      }
    } catch {
      // Fall through to a status-derived fallback message.
    }

    return `Request failed with status ${response.status}`;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}
