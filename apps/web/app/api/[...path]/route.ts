import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeAbsoluteUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, "") : null;
}

function getApiBaseUrls(): string[] {
  const candidates = [
    normalizeAbsoluteUrl(process.env.INTERNAL_API_URL),
    normalizeAbsoluteUrl(process.env.API_URL),
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_API_URL),
    "http://127.0.0.1:8000",
  ];

  const seen = new Set<string>();
  const uniqueCandidates: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    uniqueCandidates.push(candidate);
  }

  return uniqueCandidates;
}

function createTargetUrl(
  baseUrl: string,
  request: NextRequest,
  path: string[],
) {
  const targetUrl = new URL(`${baseUrl}/${path.join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });
  return targetUrl;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const headers = new Headers(request.headers);
  headers.delete("host");
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstreamInit: RequestInit = {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  };

  const attemptedUpstreams: string[] = [];
  let lastError: string | null = null;

  for (const baseUrl of getApiBaseUrls()) {
    const targetUrl = createTargetUrl(baseUrl, request, path);
    attemptedUpstreams.push(targetUrl.origin);

    try {
      const upstream = await fetch(targetUrl, upstreamInit);
      const responseHeaders = new Headers(upstream.headers);
      for (const header of HOP_BY_HOP_HEADERS) {
        responseHeaders.delete(header);
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Unknown upstream error";
    }
  }

  return Response.json(
    {
      error: "Bad Gateway",
      message: "Failed to reach API upstream using all configured candidates.",
      attemptedUpstreams,
      cause: lastError ?? "Unknown upstream error",
    },
    { status: 502 },
  );
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function HEAD(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
