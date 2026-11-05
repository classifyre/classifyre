import { NextResponse, type NextRequest } from "next/server";
import {
  FLOW_COOKIE,
  IdentityUnavailableError,
  cookieOptions,
  iamWebConfig,
  safeReturnTo,
  sessionCookies,
  tokenRequest,
  unseal,
  type TokenSet,
} from "@/lib/iam/session";

/** Where the identity server sends people back with a code to exchange. */
export async function GET(request: NextRequest) {
  const config = iamWebConfig();
  if (!config) return new NextResponse(null, { status: 404 });

  const sealed = request.cookies.get(FLOW_COOKIE)?.value;
  const flow = sealed
    ? (JSON.parse(unseal(config, sealed) ?? "null") as {
        verifier: string;
        state: string;
        returnTo: string;
      } | null)
    : null;
  const code = request.nextUrl.searchParams.get("code");
  if (!flow || !code || request.nextUrl.searchParams.get("state") !== flow.state) {
    // A stale or forged callback: start over rather than show an error page.
    return NextResponse.redirect(new URL("/auth/login", config.appUrl));
  }

  let tokens: TokenSet | null;
  try {
    tokens = await tokenRequest(config, {
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.appUrl}/auth/callback`,
      code_verifier: flow.verifier,
    });
  } catch (error) {
    if (!(error instanceof IdentityUnavailableError)) throw error;
    return new NextResponse(
      "Sign-in is unavailable for a moment. Try again in a minute.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" } },
    );
  }
  if (!tokens) {
    return NextResponse.redirect(new URL("/auth/login", config.appUrl));
  }

  const response = NextResponse.redirect(
    new URL(safeReturnTo(flow.returnTo), config.appUrl),
  );
  for (const cookie of sessionCookies(config, tokens)) {
    response.cookies.set(cookie.name, cookie.value, cookieOptions(config, cookie.maxAge));
  }
  response.cookies.delete(FLOW_COOKIE);
  return response;
}
