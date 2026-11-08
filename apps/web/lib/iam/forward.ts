import { type NextRequest } from "next/server";
import {
  allowedIamPath,
  upstreamIamBaseUrl,
  upstreamIamUrl,
} from "@/lib/iam/proxy-target";

/**
 * Shared by the `/iam` exact route and the `/iam/[...path]` catch-all: the
 * optional catch-all does not match the bare prefix in this Next version, so
 * `/iam/` needs its own route or it falls through to Next's error page.
 */

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

const STRIPPED_RESPONSE_HEADERS = ["content-encoding", "content-length"];

export async function forwardIamRequest(
  request: NextRequest,
  segments: string[],
): Promise<Response> {
  if (process.env.IAM_ENABLED !== "true") {
    return new Response(null, { status: 404 });
  }
  const base = upstreamIamBaseUrl();
  if (!base) {
    return Response.json(
      { error: "Bad Gateway", message: "Identity server is not configured." },
      { status: 502 },
    );
  }
  if (!allowedIamPath(segments)) {
    return new Response(null, { status: 404 });
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  // Keycloak builds redirects and the discovery document from the incoming
  // request; without the prefix it would answer with in-cluster URLs.
  headers.set("x-forwarded-prefix", "/iam");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  // Keycloak's endpoints are slash-sensitive: a slashless `/console` makes
  // it issue an add-a-slash redirect built from the forwarded prefix, which
  // doubles it. Pass the path through untouched instead of normalizing it.
  const hadTrailingSlash = request.nextUrl.pathname.endsWith("/");
  const targetUrl = upstreamIamUrl(
    base,
    segments,
    request.nextUrl.searchParams,
    hadTrailingSlash,
  );

  const send = (url: URL) =>
    fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    });

  let upstream: Response;
  try {
    upstream = await send(targetUrl);
    // The app's site-wide trailing-slash redirect (next.config.mjs) also
    // reaches `/iam`, so a slashless Keycloak endpoint (the consoles'
    // translations, parts of the admin API) arrives here with a slash and
    // 404s. Ask once more the way the browser first did.
    if (upstream.status === 404 && hadTrailingSlash && segments.length > 0) {
      await upstream.arrayBuffer();
      upstream = await send(
        upstreamIamUrl(base, segments, request.nextUrl.searchParams, false),
      );
    }
  } catch (error) {
    return Response.json(
      {
        error: "Bad Gateway",
        message: error instanceof Error ? error.message : "Upstream error",
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(header);
  }
  for (const header of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(header);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
