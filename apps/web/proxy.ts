import { NextResponse, type NextRequest } from "next/server";
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

  // Not signed in: with a public tenant they browse it; the API answers them
  // as visitors, read-only.
  if (config.publicTenant || request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  const login = new URL("/auth/login", config.appUrl);
  login.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

export const config = {
  // Everything but the sign-in routes, the identity server proxy, Next's
  // assets, the bundled documentation site and plain files (icons, manifest,
  // robots.txt). The `/iam` proxy serves Keycloak's own endpoints (account
  // console, JS adapter); it must not send browsers to sign in for them —
  // those requests carry no Classifyre session by design.
  matcher: ["/((?!auth/|iam/|_next/|docs/|.*\\.[a-zA-Z0-9]+$).*)"],
};
