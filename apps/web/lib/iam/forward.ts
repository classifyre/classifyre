import { type NextRequest } from "next/server";
import {
  allowedIamPath,
  upstreamIamBaseUrl,
  upstreamIamUrl,
} from "@/lib/iam/proxy-target";
import {
  FLOW_COOKIE,
  ID_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
} from "@/lib/iam/session";

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

/** Far above anything the sign-in pages or the console send. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const APP_COOKIES = new Set([
  SESSION_COOKIE,
  REFRESH_COOKIE,
  ID_COOKIE,
  FLOW_COOKIE,
]);

/** The cookie header without Classifyre's own session cookies, or null when nothing is left. */
export function withoutAppCookies(cookie: string | null): string | null {
  if (!cookie) return null;
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !APP_COOKIES.has(part.split("=")[0]!.trim()));
  return kept.length > 0 ? kept.join("; ") : null;
}

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
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  // Classifyre's own session stays here: the identity server has its own.
  const cookies = withoutAppCookies(request.headers.get("cookie"));
  if (cookies) headers.set("cookie", cookies);
  else headers.delete("cookie");
  // Only the address the nearest proxy saw; earlier entries are whatever the
  // client claimed, and the identity server logs and rate-limits by it.
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .pop()
    ?.trim();
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  else headers.delete("x-forwarded-for");
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  // Keycloak builds redirects and the discovery document from the incoming
  // request; without the prefix it would answer with in-cluster URLs.
  headers.set("x-forwarded-prefix", "/iam");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

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
    // 404s. Ask once more the way the browser first did. Safe for writes
    // too: a 404 means no endpoint matched, so nothing ran.
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
