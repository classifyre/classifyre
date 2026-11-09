import { NextResponse, type NextRequest } from "next/server";
import {
  FLOW_COOKIE,
  cookieOptions,
  iamWebConfig,
  newFlow,
  safeReturnTo,
  seal,
} from "@/lib/iam/session";
import { signInLocale } from "@/lib/iam/sign-in-locale";
import { LANGUAGE_COOKIE } from "@/lib/language-cookie";

/**
 * Starts sign-in: authorization code with PKCE. `tenant` asks for one
 * organization (switching tenants); without it the identity server picks the
 * person's only one, or shows its own picker when there are several.
 */
export function GET(request: NextRequest) {
  const config = iamWebConfig();
  if (!config) return new NextResponse(null, { status: 404 });

  const flow = newFlow();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const tenant = request.nextUrl.searchParams.get("tenant");
  const scope = `openid organization${tenant && /^[a-z0-9-]+$/i.test(tenant) ? `:${tenant}` : ""}`;

  // The sign-in pages open in the app's language (the identity server has
  // English and German, like the app, and offers a switch).
  const locale = signInLocale(returnTo, request.cookies.get(LANGUAGE_COOKIE)?.value);

  const authorize = new URL(`${config.issuerUrl}/protocol/openid-connect/auth`);
  authorize.search = new URLSearchParams({
    ...(locale ? { ui_locales: locale } : {}),
    client_id: config.clientId,
    response_type: "code",
    scope,
    redirect_uri: `${config.appUrl}/auth/callback`,
    state: flow.state,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    FLOW_COOKIE,
    seal(config, JSON.stringify({ verifier: flow.verifier, state: flow.state, returnTo })),
    cookieOptions(config, 10 * 60),
  );
  return response;
}
