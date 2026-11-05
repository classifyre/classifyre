import { NextResponse, type NextRequest } from "next/server";
import {
  ID_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  iamWebConfig,
} from "@/lib/iam/session";

/** Signs out here and at the identity server, then comes back to the start page. */
export function GET(request: NextRequest) {
  const config = iamWebConfig();
  if (!config) return new NextResponse(null, { status: 404 });

  const logout = new URL(`${config.issuerUrl}/protocol/openid-connect/logout`);
  logout.search = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: `${config.appUrl}/`,
    ...(request.cookies.get(ID_COOKIE)?.value
      ? { id_token_hint: request.cookies.get(ID_COOKIE)!.value }
      : {}),
  }).toString();

  const response = NextResponse.redirect(logout);
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE, ID_COOKIE]) {
    response.cookies.delete(name);
  }
  return response;
}
