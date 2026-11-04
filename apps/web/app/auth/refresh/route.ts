import { NextResponse, type NextRequest } from "next/server";
import {
  ID_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  iamWebConfig,
  renew,
  sessionCookies,
} from "@/lib/iam/session";

/**
 * Renews the session when the API answered 401 (the browser calls this, then
 * retries once). 204 renewed; 401 means sign-in has ended.
 */
export async function POST(request: NextRequest) {
  const config = iamWebConfig();
  if (!config) return new NextResponse(null, { status: 404 });

  const tokens = await renew(config, request.cookies.get(REFRESH_COOKIE)?.value);
  if (!tokens) {
    const ended = new NextResponse(null, { status: 401 });
    for (const name of [SESSION_COOKIE, REFRESH_COOKIE, ID_COOKIE]) {
      ended.cookies.delete(name);
    }
    return ended;
  }
  const response = new NextResponse(null, { status: 204 });
  for (const cookie of sessionCookies(config, tokens)) {
    response.cookies.set(cookie.name, cookie.value, cookieOptions(config, cookie.maxAge));
  }
  return response;
}
