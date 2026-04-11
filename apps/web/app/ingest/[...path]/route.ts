import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

const POSTHOG_HOST = "https://us.i.posthog.com";

async function proxyToPostHog(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { path = [] } = await context.params;
  const searchParams = request.nextUrl.searchParams.toString();
  const targetUrl = `${POSTHOG_HOST}/${path.join("/")}${searchParams ? `?${searchParams}` : ""}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("host", "us.i.posthog.com");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
    redirect: "follow",
  });

  const responseHeaders = new Headers(response.headers);
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
