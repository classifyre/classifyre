import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

const UPSTREAM_HOST =
  process.env.POSTHOG_INGEST_HOST ?? "https://us.i.posthog.com";

const upstreamHostname = new URL(UPSTREAM_HOST).hostname;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
  "access-control-max-age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function proxyToPostHog(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { path = [] } = await context.params;
  const searchParams = request.nextUrl.searchParams.toString();
  const targetUrl = `${UPSTREAM_HOST}/${path.join("/")}${searchParams ? `?${searchParams}` : ""}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("host", upstreamHostname);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
    redirect: "follow",
  });

  const responseHeaders = new Headers(CORS_HEADERS);
  response.headers.forEach((value, key) => {
    if (!CORS_HEADERS[key as keyof typeof CORS_HEADERS] && key !== "transfer-encoding") {
      responseHeaders.set(key, value);
    }
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxyToPostHog(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxyToPostHog(request, context);
}
