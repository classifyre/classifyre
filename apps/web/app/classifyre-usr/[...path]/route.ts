import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reverse proxy for PostHog analytics.
 *
 * Routed through /classifyre-usr/* to avoid ad-blocker detection
 * (paths containing "posthog", "analytics", "ingest", etc. are commonly blocked).
 *
 * Configure the upstream target via POSTHOG_INGEST_HOST (server-only, never exposed
 * to the client). Defaults to the PostHog US cloud ingest endpoint.
 *
 * Set NEXT_PUBLIC_POSTHOG_HOST=/classifyre-usr in your environment so the SDK
 * sends events through this proxy.
 */

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

// Server-only env var — not prefixed with NEXT_PUBLIC_ intentionally.
// Set this to your managed reverse proxy subdomain (e.g. https://e.yourcompany.com)
// or the regional PostHog ingest host (https://eu.i.posthog.com for EU Cloud).
const UPSTREAM_HOST =
  process.env.POSTHOG_INGEST_HOST ?? "https://us.i.posthog.com";

const upstreamHostname = new URL(UPSTREAM_HOST).hostname;

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

  const responseHeaders = new Headers(response.headers);
  // Transfer-encoding is hop-by-hop and must be stripped before forwarding.
  responseHeaders.delete("transfer-encoding");

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
