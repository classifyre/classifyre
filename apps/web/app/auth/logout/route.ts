import { NextResponse, type NextRequest } from "next/server";
import {
  ID_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  iamWebConfig,
} from "@/lib/iam/session";

/**
 * Signs out here and at the identity server, then comes back to the start
 * page. A POST from the app's own pages only: as a GET, or from another site,
 * any page on the web could sign people out with a link or an image.
 */
export function POST(request: NextRequest) {
  const config = iamWebConfig();
  if (!sameOrigin(request, config.appUrl)) {
    return new NextResponse(null, { status: 403 });
  }

  const logout = new URL(`${config.issuerUrl}/protocol/openid-connect/logout`);
  logout.search = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: `${config.appUrl}/`,
    ...(request.cookies.get(ID_COOKIE)?.value
      ? { id_token_hint: request.cookies.get(ID_COOKIE)!.value }
      : {}),
  }).toString();

  // 303: the browser follows with a GET.
  const response = NextResponse.redirect(logout, 303);
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE, ID_COOKIE]) {
    response.cookies.delete(name);
  }
  return response;
}

/** An old bookmark or a link: back to the app, still signed in. */
export function GET() {
  const config = iamWebConfig();
  return NextResponse.redirect(`${config.appUrl}/`, 303);
}

/** The form was posted by a page of this app (browsers always send Origin on a POST). */
function sameOrigin(request: NextRequest, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(appUrl).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
