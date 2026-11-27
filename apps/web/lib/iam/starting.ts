import { NextResponse } from "next/server";
import { safeReturnTo } from "@/lib/iam/session";

export type StartingReason = "unavailable";

/** Builds the `/auth/starting/?returnTo=...` URL against the public app origin. */
export function startingPageUrl(
  returnTo: string,
  appUrl: string,
  options?: { reason?: StartingReason },
): URL {
  const params = new URLSearchParams({ returnTo: safeReturnTo(returnTo) });
  if (options?.reason) params.set("reason", options.reason);
  return new URL(`/auth/starting/?${params.toString()}`, appUrl);
}

/** Temporary 307 redirect to the auto-refreshing startup screen. */
export function redirectToStarting(
  returnTo: string,
  appUrl: string,
  options?: { reason?: StartingReason },
): NextResponse {
  return NextResponse.redirect(startingPageUrl(returnTo, appUrl, options), {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
