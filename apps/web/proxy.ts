import { NextResponse, type NextRequest } from "next/server";
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  iamWebConfig,
  needsRenewal,
  renew,
  sessionCookies,
} from "@/lib/iam/session";

/**
 * With sign-in on (docs/prd/IAM-access-management.md §12.1): renews a session
 * about to expire, handing the new token to this very request, and sends
 * people without a session to sign in. API requests without a session are
 * left alone: the API answers 401 and the browser renews or signs in.
 * Without sign-in it does nothing.
 */
export async function proxy(request: NextRequest) {
  const config = iamWebConfig();
  if (!config) return NextResponse.next();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && !needsRenewal(session)) return NextResponse.next();

  const tokens = await renew(config, request.cookies.get(REFRESH_COOKIE)?.value);
  if (tokens) {
    const written = sessionCookies(config, tokens);
    for (const cookie of written) request.cookies.set(cookie.name, cookie.value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    for (const cookie of written) {
      response.cookies.set(cookie.name, cookie.value, cookieOptions(config, cookie.maxAge));
    }
    return response;
  }

  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const login = new URL("/auth/login", config.appUrl);
  login.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

export const config = {
  // Everything but the sign-in routes themselves, Next's assets, the bundled
  // documentation site and plain files (icons, manifest, robots.txt).
  matcher: ["/((?!auth/|_next/|docs/|.*\\.[a-zA-Z0-9]+$).*)"],
};
