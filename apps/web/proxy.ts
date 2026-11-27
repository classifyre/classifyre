import { NextResponse, type NextRequest } from "next/server";
import { checkDeploymentReadiness } from "@/lib/iam/readiness";
import {
  IdentityUnavailableError,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  iamWebConfig,
  needsRenewal,
  renew,
  secondsLeft,
  sessionCookies,
  type TokenSet,
} from "@/lib/iam/session";

const MCP_PATH_RE = /^\/(?:mcp(?:\/|$)|[^/]+\/mcp(?:\/|$))/;

function isPageNavigation(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    !MCP_PATH_RE.test(pathname)
  );
}

function rewriteToStarting(
  request: NextRequest,
  reason?: "unavailable",
): NextResponse {
  const url = request.nextUrl.clone();
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const params = new URLSearchParams({ returnTo });
  if (reason) params.set("reason", reason);
  url.pathname = "/auth/starting/";
  url.search = `?${params.toString()}`;
  return NextResponse.rewrite(url);
}

/**
 * Sign-in (docs/prd/IAM-access-management.md §12.1): renews a session about
 * to expire, handing the new token to this very request, and sends people
 * without a session to sign in. While the identity server does not answer, a
 * session that has not expired yet keeps working. API requests without a
 * session are left alone: the API answers 401 and the browser renews or signs
 * in.
 */
export async function proxy(request: NextRequest) {
  const config = iamWebConfig();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && !needsRenewal(session)) return NextResponse.next();

  let tokens: TokenSet | null;
  try {
    tokens = await renew(config, request.cookies.get(REFRESH_COOKIE)?.value);
  } catch (error) {
    if (!(error instanceof IdentityUnavailableError)) throw error;
    // The identity server is away (an upgrade, a restart): keep using the
    // session while it is still valid rather than send anyone to sign in.
    if ((secondsLeft(session) ?? 0) > 0 || request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (isPageNavigation(request)) {
      return rewriteToStarting(request, "unavailable");
    }
    return new NextResponse(
      "Sign-in is unavailable for a moment. Try again in a minute.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" } },
    );
  }
  if (tokens) {
    const written = sessionCookies(config, tokens);
    for (const cookie of written) request.cookies.set(cookie.name, cookie.value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    for (const cookie of written) {
      response.cookies.set(cookie.name, cookie.value, cookieOptions(config, cookie.maxAge));
    }
    return response;
  }

  // No active session: on page navigations, verify that the API, identity
  // server, and initial bootstrap are ready before handing the browser to the
  // app (where it would otherwise hit 401/502 or a half-configured sign-in
  // page). Stateless so proxy and route handlers never rely on shared globals.
  if (isPageNavigation(request)) {
    const readiness = await checkDeploymentReadiness();
    if (!readiness.ready) return rewriteToStarting(request);
  }

  // Not signed in: they may read the first tenant's public workspaces, as
  // visitors. The API answers anything else with 401, which sends them to
  // sign in (components/iam-session.tsx), and the workspace list sends them
  // there when nothing is public.
  return NextResponse.next();
}

export const config = {
  // Everything but the sign-in routes, the identity server proxy, Socket.IO,
  // Next's assets, the bundled documentation site, plain files (icons,
  // manifest, robots.txt), and router prefetches. The `/iam` proxy serves
  // Keycloak's own endpoints (account console, JS adapter); it must not send
  // browsers to sign in for them — those requests carry no Classifyre session
  // by design. `/socket.io/` is forwarded to the API by a rewrite: a WebSocket
  // upgrade cannot pass through this function, and the API checks the session
  // itself. Prefetch headers are filtered here rather than inside `proxy()`,
  // because Next.js 16 strips internal Flight headers before invoking `proxy`.
  matcher: [
    {
      source:
        "/((?!auth/|iam/|mcp/|socket\\.io/|_next/|docs/|[^/]+/mcp(?:/|$)|.*\\.[a-zA-Z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
